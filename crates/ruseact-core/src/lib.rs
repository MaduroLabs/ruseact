#![forbid(unsafe_code)]
#![doc = "Platform-independent reactive graph foundation for Ruseact."]

use std::any::Any;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::marker::PhantomData;
use std::num::NonZeroU64;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_GRAPH_ID: AtomicU64 = AtomicU64::new(1);

/// Identifies one [`ReactiveGraph`] within this process.
///
/// The identity is embedded in every [`NodeId`] so a handle from one graph
/// cannot accidentally address a coincident slot in another graph.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct GraphId(NonZeroU64);

impl GraphId {
    /// Returns the non-zero process-local identity value.
    pub const fn as_u64(self) -> u64 {
        self.0.get()
    }

    fn allocate() -> Result<Self, GraphError> {
        let mut candidate = NEXT_GRAPH_ID.load(Ordering::Relaxed);

        loop {
            let next = candidate.checked_add(1).ok_or(GraphError::IdExhausted)?;

            match NEXT_GRAPH_ID.compare_exchange_weak(
                candidate,
                next,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    let value = NonZeroU64::new(candidate).ok_or(GraphError::IdExhausted)?;
                    return Ok(Self(value));
                }
                Err(observed) => candidate = observed,
            }
        }
    }
}

/// Errors that can occur while creating a reactive graph.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GraphError {
    /// The process-wide graph identity space can no longer allocate an ID.
    IdExhausted,
}

impl fmt::Display for GraphError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::IdExhausted => formatter.write_str("reactive graph ID space exhausted"),
        }
    }
}

impl std::error::Error for GraphError {}

/// A stable identity for a node while that node is alive in one graph.
///
/// The graph ID identifies the owning graph, the index addresses a slot, and
/// the generation identifies the lifetime of the value currently occupying
/// that slot. A node ID must not be moved to a different graph.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct NodeId {
    graph_id: GraphId,
    index: u32,
    generation: u32,
}

impl NodeId {
    /// Returns the graph that owns this node.
    pub const fn graph_id(self) -> GraphId {
        self.graph_id
    }

    /// Returns the slot index portion of this identifier.
    pub const fn index(self) -> u32 {
        self.index
    }

    /// Returns the generation portion of this identifier.
    pub const fn generation(self) -> u32 {
        self.generation
    }
}

/// A typed, non-owning handle to a signal stored in a [`ReactiveGraph`].
///
/// Signals are copyable handles. The graph owns the value and its lifecycle;
/// dropping or copying a handle does not create or dispose a node.
#[must_use]
pub struct Signal<T> {
    node_id: NodeId,
    marker: PhantomData<fn() -> T>,
}

impl<T> Signal<T> {
    fn new(node_id: NodeId) -> Self {
        Self {
            node_id,
            marker: PhantomData,
        }
    }

    /// Returns the generational node identity represented by this handle.
    pub const fn id(self) -> NodeId {
        self.node_id
    }
}

impl<T> Copy for Signal<T> {}

impl<T> Clone for Signal<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> fmt::Debug for Signal<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Signal")
            .field("node_id", &self.node_id)
            .finish()
    }
}

impl<T> PartialEq for Signal<T> {
    fn eq(&self, other: &Self) -> bool {
        self.node_id == other.node_id
    }
}

impl<T> Eq for Signal<T> {}

impl<T> Hash for Signal<T> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.node_id.hash(state);
    }
}

/// The result of writing a value to a signal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SignalUpdate {
    /// The new value was not equal to the previous value and was stored.
    Changed,
    /// The new value was equal to the previous value, so no update occurred.
    Unchanged,
}

/// Errors returned when a signal handle cannot be used by a graph operation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SignalError {
    /// The handle is stale, disposed, out of range, or belongs to another
    /// graph.
    InvalidNode(NodeId),
    /// The storage associated with a valid node did not contain the requested
    /// signal type. This indicates a violated internal invariant or a forged
    /// handle at an integration boundary.
    TypeMismatch(NodeId),
    /// The graph cannot allocate another slot because its `u32` node index
    /// space is exhausted.
    NodeIdExhausted,
}

impl fmt::Display for SignalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidNode(node_id) => write!(formatter, "invalid node {node_id:?}"),
            Self::TypeMismatch(node_id) => {
                write!(formatter, "type mismatch for node {node_id:?}")
            }
            Self::NodeIdExhausted => formatter.write_str("node ID space exhausted"),
        }
    }
}

impl std::error::Error for SignalError {}

struct NodeSlot {
    generation: u32,
    value: Option<Box<dyn Any>>,
}

impl NodeSlot {
    fn vacant(generation: u32) -> Self {
        Self {
            generation,
            value: None,
        }
    }
}

/// The graph-owned storage for signals and their generational identities.
///
/// M1.1 deliberately models only signal storage and lifecycle. It does not
/// schedule subscribers, flush a dirty queue, execute callbacks, or create
/// mutation intents. Those behaviors will be added by later milestones with
/// separate invariants and tests.
pub struct ReactiveGraph {
    graph_id: GraphId,
    slots: Vec<NodeSlot>,
    free_slots: Vec<u32>,
    active_nodes: usize,
}

impl ReactiveGraph {
    /// Creates a graph, returning an error only if the process-wide graph ID
    /// space is exhausted.
    pub fn try_new() -> Result<Self, GraphError> {
        Ok(Self {
            graph_id: GraphId::allocate()?,
            slots: Vec::new(),
            free_slots: Vec::new(),
            active_nodes: 0,
        })
    }

    /// Creates an empty reactive graph.
    ///
    /// `new` is infallible for normal operation. It panics only after the
    /// process-wide graph ID space has been exhausted; callers that need to
    /// handle that condition can use [`Self::try_new`].
    pub fn new() -> Self {
        Self::try_new().expect("reactive graph ID space exhausted")
    }

    /// Returns this graph's process-local identity.
    pub const fn graph_id(&self) -> GraphId {
        self.graph_id
    }

    /// Returns the number of live nodes owned by this graph.
    pub const fn len(&self) -> usize {
        self.active_nodes
    }

    /// Returns whether this graph owns no live nodes.
    pub const fn is_empty(&self) -> bool {
        self.active_nodes == 0
    }

    /// Creates a signal with an initial value.
    ///
    /// Signal updates use [`PartialEq`] to decide whether a write changed the
    /// value. The bound is therefore required at creation time as well as at
    /// write time. The graph owns the value; the returned signal is only a
    /// typed, copyable handle.
    pub fn create_signal<T>(&mut self, value: T) -> Result<Signal<T>, SignalError>
    where
        T: PartialEq + 'static,
    {
        let (index, generation) = match self.free_slots.pop() {
            Some(index) => {
                let slot = &self.slots[index as usize];
                debug_assert!(slot.value.is_none());
                (index, slot.generation)
            }
            None => {
                let index =
                    u32::try_from(self.slots.len()).map_err(|_| SignalError::NodeIdExhausted)?;
                self.slots.push(NodeSlot::vacant(0));
                (index, 0)
            }
        };

        let slot = &mut self.slots[index as usize];
        debug_assert!(slot.value.is_none());
        slot.value = Some(Box::new(value));
        self.active_nodes += 1;

        Ok(Signal::new(NodeId {
            graph_id: self.graph_id,
            index,
            generation,
        }))
    }

    /// Reads a signal value by reference.
    pub fn read<T>(&self, signal: Signal<T>) -> Result<&T, SignalError>
    where
        T: 'static,
    {
        let node_id = signal.id();
        let slot = self.slot(node_id)?;
        let value = slot
            .value
            .as_deref()
            .ok_or(SignalError::InvalidNode(node_id))?;

        value
            .downcast_ref::<T>()
            .ok_or(SignalError::TypeMismatch(node_id))
    }

    /// Writes a signal value and reports whether the value changed.
    ///
    /// Equality is determined by `PartialEq`. An equal write leaves the
    /// stored value untouched and returns [`SignalUpdate::Unchanged`]. M1.1
    /// does not notify subscribers or schedule work for a changed signal;
    /// notification is intentionally a later graph concern.
    pub fn set<T>(&mut self, signal: Signal<T>, value: T) -> Result<SignalUpdate, SignalError>
    where
        T: PartialEq + 'static,
    {
        let node_id = signal.id();
        let slot = self.slot_mut(node_id)?;
        let stored = slot
            .value
            .as_deref_mut()
            .ok_or(SignalError::InvalidNode(node_id))?;
        let stored = stored
            .downcast_mut::<T>()
            .ok_or(SignalError::TypeMismatch(node_id))?;

        if *stored == value {
            Ok(SignalUpdate::Unchanged)
        } else {
            *stored = value;
            Ok(SignalUpdate::Changed)
        }
    }

    /// Disposes a signal node and invalidates all handles for its generation.
    ///
    /// Disposal is explicit because handles are non-owning and copyable. A
    /// disposed slot may be reused, but its generation is incremented first,
    /// so an old handle cannot access the replacement value.
    pub fn dispose<T>(&mut self, signal: Signal<T>) -> Result<(), SignalError> {
        self.dispose_node(signal.id())
    }

    /// Disposes a live node by its generational identity.
    pub fn dispose_node(&mut self, node_id: NodeId) -> Result<(), SignalError> {
        let reusable = {
            let slot = self.slot_mut(node_id)?;
            let _ = slot.value.take().ok_or(SignalError::InvalidNode(node_id))?;

            match slot.generation.checked_add(1) {
                Some(next_generation) => {
                    slot.generation = next_generation;
                    true
                }
                None => false,
            }
        };

        self.active_nodes -= 1;
        if reusable {
            self.free_slots.push(node_id.index);
        }

        Ok(())
    }

    fn slot(&self, node_id: NodeId) -> Result<&NodeSlot, SignalError> {
        if node_id.graph_id != self.graph_id {
            return Err(SignalError::InvalidNode(node_id));
        }

        let slot = self
            .slots
            .get(node_id.index as usize)
            .ok_or(SignalError::InvalidNode(node_id))?;

        if slot.generation != node_id.generation || slot.value.is_none() {
            return Err(SignalError::InvalidNode(node_id));
        }

        Ok(slot)
    }

    fn slot_mut(&mut self, node_id: NodeId) -> Result<&mut NodeSlot, SignalError> {
        if node_id.graph_id != self.graph_id {
            return Err(SignalError::InvalidNode(node_id));
        }

        let slot = self
            .slots
            .get_mut(node_id.index as usize)
            .ok_or(SignalError::InvalidNode(node_id))?;

        if slot.generation != node_id.generation || slot.value.is_none() {
            return Err(SignalError::InvalidNode(node_id));
        }

        Ok(slot)
    }
}

impl Default for ReactiveGraph {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_starts_empty() {
        let graph = ReactiveGraph::new();

        assert!(graph.is_empty());
        assert_eq!(graph.len(), 0);
    }

    #[test]
    fn signal_can_be_created_read_and_updated() {
        let mut graph = ReactiveGraph::new();
        let signal = graph
            .create_signal(10_u32)
            .expect("signal creation should succeed");

        assert_eq!(signal.id().graph_id(), graph.graph_id());
        assert_eq!(signal.id().index(), 0);
        assert_eq!(signal.id().generation(), 0);
        assert_eq!(graph.len(), 1);
        assert_eq!(*graph.read(signal).expect("signal should be readable"), 10);
        assert_eq!(graph.set(signal, 20), Ok(SignalUpdate::Changed));
        assert_eq!(
            *graph.read(signal).expect("signal should remain readable"),
            20
        );
    }

    #[test]
    fn equal_writes_are_unchanged() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(String::from("same")).unwrap();

        assert_eq!(
            graph.set(signal, String::from("same")),
            Ok(SignalUpdate::Unchanged)
        );
        assert_eq!(graph.len(), 1);
        assert_eq!(graph.read(signal).unwrap(), "same");
    }

    #[test]
    fn stale_handles_are_rejected_after_disposal() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(1_u32).unwrap();
        let node_id = signal.id();

        graph.dispose(signal).unwrap();

        assert!(graph.is_empty());
        assert_eq!(graph.read(signal), Err(SignalError::InvalidNode(node_id)));
        assert_eq!(graph.set(signal, 2), Err(SignalError::InvalidNode(node_id)));
        assert_eq!(
            graph.dispose(signal),
            Err(SignalError::InvalidNode(node_id))
        );
    }

    #[test]
    fn disposed_slots_reuse_index_with_a_new_generation() {
        let mut graph = ReactiveGraph::new();
        let first = graph.create_signal("first").unwrap();
        let first_id = first.id();

        graph.dispose_node(first_id).unwrap();
        let replacement = graph.create_signal("replacement").unwrap();
        let replacement_id = replacement.id();

        assert_eq!(replacement_id.index(), first_id.index());
        assert_eq!(replacement_id.generation(), first_id.generation() + 1);
        assert_eq!(graph.read(first), Err(SignalError::InvalidNode(first_id)));
        assert_eq!(graph.read(replacement), Ok(&"replacement"));
    }

    #[test]
    fn handles_from_another_graph_are_rejected_even_when_slots_collide() {
        let mut source = ReactiveGraph::new();
        let source_signal = source.create_signal(1_u32).unwrap();
        let mut target = ReactiveGraph::new();
        let target_signal = target.create_signal(10_u32).unwrap();
        let foreign_id = source_signal.id();

        assert_eq!(foreign_id.index(), target_signal.id().index());
        assert_ne!(foreign_id.graph_id(), target.graph_id());
        assert_eq!(
            target.read(source_signal),
            Err(SignalError::InvalidNode(foreign_id))
        );
        assert_eq!(
            target.set(source_signal, 2),
            Err(SignalError::InvalidNode(foreign_id))
        );
        assert_eq!(
            target.dispose(source_signal),
            Err(SignalError::InvalidNode(foreign_id))
        );
        assert_eq!(
            target.dispose_node(foreign_id),
            Err(SignalError::InvalidNode(foreign_id))
        );
        assert_eq!(*target.read(target_signal).unwrap(), 10);
    }

    #[test]
    fn type_mismatch_is_rejected_without_mutating_the_value() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(7_u32).unwrap();
        let wrong_type = Signal::<String>::new(signal.id());

        assert_eq!(
            graph.read(wrong_type),
            Err(SignalError::TypeMismatch(signal.id()))
        );
        assert_eq!(
            graph.set(wrong_type, String::from("wrong type")),
            Err(SignalError::TypeMismatch(signal.id()))
        );
        assert_eq!(*graph.read(signal).unwrap(), 7);
    }

    #[test]
    fn generation_exhaustion_retires_the_slot_instead_of_reusing_it() {
        let mut graph = ReactiveGraph::new();
        let initial = graph.create_signal(1_u32).unwrap();
        let index = initial.id().index() as usize;

        graph.slots[index].generation = u32::MAX;
        let final_generation = Signal::<u32>::new(NodeId {
            graph_id: graph.graph_id(),
            index: initial.id().index(),
            generation: u32::MAX,
        });

        assert_eq!(*graph.read(final_generation).unwrap(), 1);
        graph.dispose_node(final_generation.id()).unwrap();

        let replacement = graph.create_signal(2_u32).unwrap();
        assert_ne!(replacement.id().index(), final_generation.id().index());
        assert_eq!(replacement.id().generation(), 0);
        assert_eq!(
            graph.read(final_generation),
            Err(SignalError::InvalidNode(final_generation.id()))
        );
    }
}
