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

/// A stable, graph-scoped identity for a registered computation.
///
/// Computations are represented by graph-owned metadata only. The ID is the
/// handle used to register dependencies and to identify pending dirty work;
/// it does not execute any callback.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ComputationId {
    graph_id: GraphId,
    index: u32,
    generation: u32,
}

impl ComputationId {
    /// Returns the graph that owns this computation.
    pub const fn graph_id(self) -> GraphId {
        self.graph_id
    }

    /// Returns the computation slot index portion of this identifier.
    pub const fn index(self) -> u32 {
        self.index
    }

    /// Returns the computation lifetime generation portion of this identifier.
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

/// Errors returned when dependency metadata cannot be updated safely.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DependencyError {
    /// The signal handle is stale, disposed, out of range, or belongs to
    /// another graph.
    InvalidSignal(NodeId),
    /// The computation handle is stale, disposed, out of range, or belongs
    /// to another graph.
    InvalidComputation(ComputationId),
    /// The graph cannot allocate another computation slot because its `u32`
    /// computation index space is exhausted.
    ComputationIdExhausted,
}

impl fmt::Display for DependencyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSignal(node_id) => {
                write!(formatter, "invalid signal {node_id:?}")
            }
            Self::InvalidComputation(computation_id) => {
                write!(formatter, "invalid computation {computation_id:?}")
            }
            Self::ComputationIdExhausted => formatter.write_str("computation ID space exhausted"),
        }
    }
}

impl std::error::Error for DependencyError {}

struct NodeSlot {
    generation: u32,
    value: Option<Box<dyn Any>>,
    subscribers: Vec<ComputationId>,
}

impl NodeSlot {
    fn vacant(generation: u32) -> Self {
        Self {
            generation,
            value: None,
            subscribers: Vec::new(),
        }
    }
}

struct ComputationSlot {
    generation: u32,
    dependencies: Option<Vec<NodeId>>,
    dirty: bool,
}

impl ComputationSlot {
    fn vacant(generation: u32) -> Self {
        Self {
            generation,
            dependencies: None,
            dirty: false,
        }
    }
}

/// The graph-owned storage for signals and their generational identities.
///
/// M1.3 adds deterministic dirty propagation and an explicit queue-drain API
/// to the M1.2 signal storage, computation identity, and bidirectional
/// dependency metadata. The graph never executes computation bodies or
/// callbacks; a host may drain the IDs and decide how to process them in a
/// later milestone.
pub struct ReactiveGraph {
    graph_id: GraphId,
    slots: Vec<NodeSlot>,
    free_slots: Vec<u32>,
    active_nodes: usize,
    computation_slots: Vec<ComputationSlot>,
    free_computation_slots: Vec<u32>,
    active_computations: usize,
    pending_computations: Vec<ComputationId>,
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
            computation_slots: Vec::new(),
            free_computation_slots: Vec::new(),
            active_computations: 0,
            pending_computations: Vec::new(),
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

    /// Registers an empty computation metadata record.
    ///
    /// A computation has no executable body. Its generational ID is used to
    /// maintain explicit signal dependency edges and identify dirty work.
    pub fn create_computation(&mut self) -> Result<ComputationId, DependencyError> {
        let (index, generation) = match self.free_computation_slots.pop() {
            Some(index) => {
                let slot = &self.computation_slots[index as usize];
                debug_assert!(slot.dependencies.is_none());
                (index, slot.generation)
            }
            None => {
                let index = u32::try_from(self.computation_slots.len())
                    .map_err(|_| DependencyError::ComputationIdExhausted)?;
                self.computation_slots.push(ComputationSlot::vacant(0));
                (index, 0)
            }
        };

        let slot = &mut self.computation_slots[index as usize];
        debug_assert!(slot.dependencies.is_none());
        slot.dependencies = Some(Vec::new());
        slot.dirty = false;
        self.active_computations += 1;

        Ok(ComputationId {
            graph_id: self.graph_id,
            index,
            generation,
        })
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

    /// Adds a signal-to-computation dependency edge.
    ///
    /// Returns `true` when a new edge was added and `false` when the edge was
    /// already present. Subscription changes do not create dirty work.
    pub fn subscribe<T>(
        &mut self,
        signal: Signal<T>,
        computation: ComputationId,
    ) -> Result<bool, DependencyError> {
        let node_id = signal.id();
        let signal_index = self.signal_index_for_dependency(node_id)?;
        let computation_index = self.computation_index(computation)?;
        let signal_has_edge = self.slots[signal_index].subscribers.contains(&computation);
        let computation_has_edge = self.computation_slots[computation_index]
            .dependencies
            .as_ref()
            .expect("validated computation must have dependencies")
            .contains(&node_id);

        debug_assert_eq!(signal_has_edge, computation_has_edge);

        if !signal_has_edge {
            self.slots[signal_index].subscribers.push(computation);
        }
        if !computation_has_edge {
            self.computation_slots[computation_index]
                .dependencies
                .as_mut()
                .expect("validated computation must have dependencies")
                .push(node_id);
        }

        Ok(!signal_has_edge)
    }

    /// Removes a signal-to-computation dependency edge.
    ///
    /// Returns `true` when an edge was removed and `false` when no edge was
    /// present. Repeated unsubscription is therefore safe and idempotent.
    pub fn unsubscribe<T>(
        &mut self,
        signal: Signal<T>,
        computation: ComputationId,
    ) -> Result<bool, DependencyError> {
        let node_id = signal.id();
        let signal_index = self.signal_index_for_dependency(node_id)?;
        let computation_index = self.computation_index(computation)?;
        let signal_had_edge = self.slots[signal_index].subscribers.contains(&computation);
        let computation_had_edge = self.computation_slots[computation_index]
            .dependencies
            .as_ref()
            .expect("validated computation must have dependencies")
            .contains(&node_id);

        self.slots[signal_index]
            .subscribers
            .retain(|subscriber| *subscriber != computation);
        self.computation_slots[computation_index]
            .dependencies
            .as_mut()
            .expect("validated computation must have dependencies")
            .retain(|dependency| *dependency != node_id);

        debug_assert_eq!(signal_had_edge, computation_had_edge);
        Ok(signal_had_edge || computation_had_edge)
    }

    /// Replaces all dependencies of a computation with a validated set.
    ///
    /// Duplicate signal IDs are ignored while preserving the first-seen
    /// order. Every requested signal is validated before any existing edge is
    /// removed, so an invalid replacement leaves the graph unchanged.
    pub fn replace_dependencies(
        &mut self,
        computation: ComputationId,
        dependencies: &[NodeId],
    ) -> Result<(), DependencyError> {
        let computation_index = self.computation_index(computation)?;
        let mut next_dependencies = Vec::with_capacity(dependencies.len());

        for &node_id in dependencies {
            self.signal_index_for_dependency(node_id)?;
            if !next_dependencies.contains(&node_id) {
                next_dependencies.push(node_id);
            }
        }

        let previous_dependencies = self.computation_slots[computation_index]
            .dependencies
            .as_ref()
            .expect("validated computation must have dependencies")
            .clone();

        for node_id in previous_dependencies {
            self.remove_subscriber(node_id, computation);
        }
        for &node_id in &next_dependencies {
            self.add_subscriber(node_id, computation);
        }
        self.computation_slots[computation_index].dependencies = Some(next_dependencies);

        Ok(())
    }

    /// Disposes a computation, removes its dependency edges, and removes any
    /// pending dirty work for its generation.
    pub fn dispose_computation(
        &mut self,
        computation: ComputationId,
    ) -> Result<(), DependencyError> {
        let computation_index = self.computation_index(computation)?;
        self.remove_pending_computation(computation);
        let dependencies = self.computation_slots[computation_index]
            .dependencies
            .as_ref()
            .expect("validated computation must have dependencies")
            .clone();

        for node_id in dependencies {
            self.remove_subscriber(node_id, computation);
        }

        let reusable = {
            let slot = &mut self.computation_slots[computation_index];
            let _ = slot
                .dependencies
                .take()
                .expect("validated computation must have dependencies");

            match slot.generation.checked_add(1) {
                Some(next_generation) => {
                    slot.generation = next_generation;
                    true
                }
                None => false,
            }
        };

        self.active_computations -= 1;
        if reusable {
            self.free_computation_slots.push(computation.index);
        }

        Ok(())
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
    /// stored value untouched and produces no dirty work. A changed write
    /// marks each live subscriber dirty; each computation remains queued only
    /// once until [`Self::drain_pending_computations`] is called.
    pub fn set<T>(&mut self, signal: Signal<T>, value: T) -> Result<SignalUpdate, SignalError>
    where
        T: PartialEq + 'static,
    {
        let node_id = signal.id();
        let slot = self.slot_mut(node_id)?;
        let subscribers = {
            let stored = slot
                .value
                .as_deref_mut()
                .ok_or(SignalError::InvalidNode(node_id))?;
            let stored = stored
                .downcast_mut::<T>()
                .ok_or(SignalError::TypeMismatch(node_id))?;

            if *stored == value {
                return Ok(SignalUpdate::Unchanged);
            }

            *stored = value;
            slot.subscribers.clone()
        };

        for computation in subscribers {
            self.mark_computation_dirty(computation);
        }

        Ok(SignalUpdate::Changed)
    }

    /// Removes and returns all currently pending computation IDs.
    ///
    /// IDs are returned in deterministic first-dirtied order. A computation
    /// dirtied by multiple changed signals or writes before this call appears
    /// once. The returned IDs are only identities: this method does not
    /// execute a body, callback, render, batch, or other host work. A later
    /// changed signal may enqueue the same computation again after it has been
    /// drained.
    pub fn drain_pending_computations(&mut self) -> Vec<ComputationId> {
        let pending = std::mem::take(&mut self.pending_computations);
        let mut drained = Vec::with_capacity(pending.len());

        for computation in pending {
            if let Ok(index) = self.computation_index(computation) {
                self.computation_slots[index].dirty = false;
                drained.push(computation);
            }
        }

        drained
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
        let (reusable, subscribers) = {
            let slot = self.slot_mut(node_id)?;
            let subscribers = std::mem::take(&mut slot.subscribers);
            let _ = slot.value.take().ok_or(SignalError::InvalidNode(node_id))?;

            let reusable = match slot.generation.checked_add(1) {
                Some(next_generation) => {
                    slot.generation = next_generation;
                    true
                }
                None => false,
            };

            (reusable, subscribers)
        };

        for computation in subscribers {
            self.remove_dependency(computation, node_id);
        }

        self.active_nodes -= 1;
        if reusable {
            self.free_slots.push(node_id.index);
        }

        Ok(())
    }

    fn signal_index_for_dependency(&self, node_id: NodeId) -> Result<usize, DependencyError> {
        self.slot(node_id)
            .map(|_| node_id.index as usize)
            .map_err(|_| DependencyError::InvalidSignal(node_id))
    }

    fn computation_index(&self, computation: ComputationId) -> Result<usize, DependencyError> {
        if computation.graph_id != self.graph_id {
            return Err(DependencyError::InvalidComputation(computation));
        }

        let index = computation.index as usize;
        let slot = self
            .computation_slots
            .get(index)
            .ok_or(DependencyError::InvalidComputation(computation))?;

        if slot.generation != computation.generation || slot.dependencies.is_none() {
            return Err(DependencyError::InvalidComputation(computation));
        }

        Ok(index)
    }

    fn add_subscriber(&mut self, node_id: NodeId, computation: ComputationId) {
        if let Some(slot) = self.slots.get_mut(node_id.index as usize) {
            debug_assert_eq!(node_id.graph_id, self.graph_id);
            debug_assert_eq!(slot.generation, node_id.generation);
            if !slot.subscribers.contains(&computation) {
                slot.subscribers.push(computation);
            }
        }
    }

    fn remove_subscriber(&mut self, node_id: NodeId, computation: ComputationId) {
        if let Some(slot) = self.slots.get_mut(node_id.index as usize) {
            debug_assert_eq!(node_id.graph_id, self.graph_id);
            debug_assert_eq!(slot.generation, node_id.generation);
            slot.subscribers
                .retain(|subscriber| *subscriber != computation);
        }
    }

    fn remove_dependency(&mut self, computation: ComputationId, node_id: NodeId) {
        if let Some(slot) = self.computation_slots.get_mut(computation.index as usize) {
            debug_assert_eq!(computation.graph_id, self.graph_id);
            debug_assert_eq!(slot.generation, computation.generation);
            if let Some(dependencies) = slot.dependencies.as_mut() {
                dependencies.retain(|dependency| *dependency != node_id);
            }
        }
    }

    fn mark_computation_dirty(&mut self, computation: ComputationId) {
        if computation.graph_id != self.graph_id {
            return;
        }

        let index = computation.index as usize;
        let should_enqueue = {
            let Some(slot) = self.computation_slots.get_mut(index) else {
                return;
            };

            if slot.generation != computation.generation || slot.dependencies.is_none() {
                return;
            }

            if slot.dirty {
                false
            } else {
                slot.dirty = true;
                true
            }
        };

        if should_enqueue {
            self.pending_computations.push(computation);
        }
    }

    fn remove_pending_computation(&mut self, computation: ComputationId) {
        self.pending_computations
            .retain(|pending| *pending != computation);

        if computation.graph_id == self.graph_id
            && let Some(slot) = self.computation_slots.get_mut(computation.index as usize)
            && slot.generation == computation.generation
        {
            slot.dirty = false;
        }
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
    fn computations_have_graph_scoped_generational_ids() {
        let mut graph = ReactiveGraph::new();
        let computation = graph.create_computation().unwrap();

        assert_eq!(computation.graph_id(), graph.graph_id());
        assert_eq!(computation.index(), 0);
        assert_eq!(computation.generation(), 0);
        assert_eq!(graph.active_computations, 1);
    }

    #[test]
    fn disposed_computation_slots_reuse_index_with_a_new_generation() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(1_u32).unwrap();
        let first = graph.create_computation().unwrap();

        graph.dispose_computation(first).unwrap();
        let replacement = graph.create_computation().unwrap();

        assert_eq!(replacement.index(), first.index());
        assert_eq!(replacement.generation(), first.generation() + 1);
        assert_eq!(
            graph.subscribe(signal, first),
            Err(DependencyError::InvalidComputation(first))
        );
        assert_eq!(graph.subscribe(signal, replacement), Ok(true));
    }

    #[test]
    fn multiple_dependencies_are_registered_in_both_directions() {
        let mut graph = ReactiveGraph::new();
        let first = graph.create_signal(1_u32).unwrap();
        let second = graph.create_signal(2_u32).unwrap();
        let computation = graph.create_computation().unwrap();

        assert_eq!(graph.subscribe(first, computation), Ok(true));
        assert_eq!(graph.subscribe(second, computation), Ok(true));
        assert_eq!(
            graph.computation_slots[computation.index() as usize]
                .dependencies
                .as_ref(),
            Some(&vec![first.id(), second.id()])
        );
        assert_eq!(
            graph.slots[first.id().index() as usize].subscribers,
            vec![computation]
        );
        assert_eq!(
            graph.slots[second.id().index() as usize].subscribers,
            vec![computation]
        );
    }

    #[test]
    fn duplicate_subscriptions_and_unsubscriptions_are_idempotent() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(1_u32).unwrap();
        let computation = graph.create_computation().unwrap();

        assert_eq!(graph.subscribe(signal, computation), Ok(true));
        assert_eq!(graph.subscribe(signal, computation), Ok(false));
        assert_eq!(
            graph.slots[signal.id().index() as usize].subscribers,
            vec![computation]
        );
        assert_eq!(
            graph.computation_slots[computation.index() as usize]
                .dependencies
                .as_ref(),
            Some(&vec![signal.id()])
        );

        assert_eq!(graph.unsubscribe(signal, computation), Ok(true));
        assert_eq!(graph.unsubscribe(signal, computation), Ok(false));
        assert!(
            graph.slots[signal.id().index() as usize]
                .subscribers
                .is_empty()
        );
        assert!(
            graph.computation_slots[computation.index() as usize]
                .dependencies
                .as_ref()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn dependency_replacement_deduplicates_and_removes_old_edges() {
        let mut graph = ReactiveGraph::new();
        let first = graph.create_signal(1_u32).unwrap();
        let second = graph.create_signal(2_u32).unwrap();
        let third = graph.create_signal(3_u32).unwrap();
        let computation = graph.create_computation().unwrap();

        graph
            .replace_dependencies(computation, &[first.id(), second.id(), first.id()])
            .unwrap();
        assert_eq!(
            graph.computation_slots[computation.index() as usize]
                .dependencies
                .as_ref(),
            Some(&vec![first.id(), second.id()])
        );

        graph
            .replace_dependencies(computation, &[second.id(), third.id(), second.id()])
            .unwrap();
        assert_eq!(
            graph.computation_slots[computation.index() as usize]
                .dependencies
                .as_ref(),
            Some(&vec![second.id(), third.id()])
        );
        assert!(
            graph.slots[first.id().index() as usize]
                .subscribers
                .is_empty()
        );
        assert_eq!(
            graph.slots[second.id().index() as usize].subscribers,
            vec![computation]
        );
        assert_eq!(
            graph.slots[third.id().index() as usize].subscribers,
            vec![computation]
        );
    }

    #[test]
    fn signal_and_computation_disposal_clean_up_both_directions() {
        let mut graph = ReactiveGraph::new();
        let first = graph.create_signal(1_u32).unwrap();
        let second = graph.create_signal(2_u32).unwrap();
        let computation = graph.create_computation().unwrap();

        graph.subscribe(first, computation).unwrap();
        graph.subscribe(second, computation).unwrap();
        graph.dispose(first).unwrap();

        assert_eq!(
            graph.computation_slots[computation.index() as usize]
                .dependencies
                .as_ref(),
            Some(&vec![second.id()])
        );
        assert!(
            graph.slots[first.id().index() as usize]
                .subscribers
                .is_empty()
        );
        assert_eq!(
            graph.slots[second.id().index() as usize].subscribers,
            vec![computation]
        );

        graph.dispose_computation(computation).unwrap();
        assert!(
            graph.slots[second.id().index() as usize]
                .subscribers
                .is_empty()
        );
        assert_eq!(graph.active_computations, 0);
        assert_eq!(
            graph.dispose_computation(computation),
            Err(DependencyError::InvalidComputation(computation))
        );
    }

    #[test]
    fn changed_signals_propagate_in_deterministic_subscriber_order() {
        let mut graph = ReactiveGraph::new();
        let first_signal = graph.create_signal(1_u32).unwrap();
        let second_signal = graph.create_signal(2_u32).unwrap();
        let first = graph.create_computation().unwrap();
        let second = graph.create_computation().unwrap();
        let third = graph.create_computation().unwrap();

        graph.subscribe(first_signal, first).unwrap();
        graph.subscribe(first_signal, second).unwrap();
        graph.subscribe(second_signal, second).unwrap();
        graph.subscribe(second_signal, third).unwrap();

        assert_eq!(graph.set(first_signal, 10), Ok(SignalUpdate::Changed));
        assert_eq!(graph.set(second_signal, 20), Ok(SignalUpdate::Changed));
        assert_eq!(
            graph.drain_pending_computations(),
            vec![first, second, third]
        );

        assert!(graph.drain_pending_computations().is_empty());
        assert_eq!(graph.set(second_signal, 21), Ok(SignalUpdate::Changed));
        assert_eq!(graph.drain_pending_computations(), vec![second, third]);
    }

    #[test]
    fn unchanged_signal_values_do_not_propagate() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(String::from("same")).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        assert_eq!(
            graph.set(signal, String::from("same")),
            Ok(SignalUpdate::Unchanged)
        );
        assert!(graph.drain_pending_computations().is_empty());

        assert_eq!(
            graph.set(signal, String::from("changed")),
            Ok(SignalUpdate::Changed)
        );
        assert_eq!(
            graph.set(signal, String::from("changed")),
            Ok(SignalUpdate::Unchanged)
        );
        assert_eq!(graph.drain_pending_computations(), vec![computation]);
    }

    #[test]
    fn repeated_changes_before_draining_are_deduplicated() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(0_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        assert_eq!(graph.set(signal, 1), Ok(SignalUpdate::Changed));
        assert_eq!(graph.set(signal, 2), Ok(SignalUpdate::Changed));
        assert_eq!(graph.set(signal, 3), Ok(SignalUpdate::Changed));
        assert_eq!(graph.drain_pending_computations(), vec![computation]);

        assert_eq!(graph.set(signal, 4), Ok(SignalUpdate::Changed));
        assert_eq!(graph.drain_pending_computations(), vec![computation]);
    }

    #[test]
    fn pending_work_survives_dependency_changes_without_future_old_updates() {
        let mut graph = ReactiveGraph::new();
        let first = graph.create_signal(1_u32).unwrap();
        let second = graph.create_signal(2_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(first, computation).unwrap();

        assert_eq!(graph.set(first, 10), Ok(SignalUpdate::Changed));
        graph
            .replace_dependencies(computation, &[second.id()])
            .unwrap();
        assert_eq!(graph.set(first, 11), Ok(SignalUpdate::Changed));
        assert_eq!(graph.drain_pending_computations(), vec![computation]);

        assert_eq!(graph.set(first, 12), Ok(SignalUpdate::Changed));
        assert!(graph.drain_pending_computations().is_empty());
        assert_eq!(graph.set(second, 20), Ok(SignalUpdate::Changed));
        assert_eq!(graph.drain_pending_computations(), vec![computation]);
    }

    #[test]
    fn signal_disposal_cleans_edges_but_does_not_return_stale_work() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(1_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        assert_eq!(graph.set(signal, 2), Ok(SignalUpdate::Changed));
        graph.dispose(signal).unwrap();
        assert!(
            graph.computation_slots[computation.index() as usize]
                .dependencies
                .as_ref()
                .unwrap()
                .is_empty()
        );
        assert_eq!(graph.drain_pending_computations(), vec![computation]);
        assert_eq!(
            graph.set(signal, 3),
            Err(SignalError::InvalidNode(signal.id()))
        );
        assert!(graph.drain_pending_computations().is_empty());
    }

    #[test]
    fn disposing_a_dirty_computation_removes_pending_work_before_reuse() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(1_u32).unwrap();
        let first = graph.create_computation().unwrap();
        graph.subscribe(signal, first).unwrap();

        assert_eq!(graph.set(signal, 2), Ok(SignalUpdate::Changed));
        graph.dispose_computation(first).unwrap();
        assert!(graph.drain_pending_computations().is_empty());

        let replacement = graph.create_computation().unwrap();
        assert_eq!(replacement.index(), first.index());
        assert_eq!(replacement.generation(), first.generation() + 1);
        graph.subscribe(signal, replacement).unwrap();
        assert_eq!(graph.set(signal, 3), Ok(SignalUpdate::Changed));
        assert_eq!(graph.drain_pending_computations(), vec![replacement]);
        assert_ne!(first, replacement);
    }

    #[test]
    fn dirty_work_is_isolated_between_graphs_and_invalid_writes_are_safe() {
        let mut source = ReactiveGraph::new();
        let source_signal = source.create_signal(1_u32).unwrap();
        let source_computation = source.create_computation().unwrap();
        source.subscribe(source_signal, source_computation).unwrap();

        let mut target = ReactiveGraph::new();
        let target_signal = target.create_signal(1_u32).unwrap();
        let target_computation = target.create_computation().unwrap();
        target.subscribe(target_signal, target_computation).unwrap();

        assert_eq!(
            target.set(source_signal, 2),
            Err(SignalError::InvalidNode(source_signal.id()))
        );
        assert!(target.drain_pending_computations().is_empty());

        assert_eq!(source.set(source_signal, 2), Ok(SignalUpdate::Changed));
        assert_eq!(
            source.drain_pending_computations(),
            vec![source_computation]
        );
        assert!(target.drain_pending_computations().is_empty());

        target.dispose(target_signal).unwrap();
        assert_eq!(
            target.set(target_signal, 2),
            Err(SignalError::InvalidNode(target_signal.id()))
        );
        assert!(target.drain_pending_computations().is_empty());
    }

    #[test]
    fn stale_and_cross_graph_dependency_handles_are_rejected() {
        let mut source = ReactiveGraph::new();
        let foreign_signal = source.create_signal(1_u32).unwrap();
        let foreign_computation = source.create_computation().unwrap();

        let mut target = ReactiveGraph::new();
        let local_signal = target.create_signal(2_u32).unwrap();
        let local_computation = target.create_computation().unwrap();
        target.subscribe(local_signal, local_computation).unwrap();

        assert_eq!(
            target.subscribe(foreign_signal, local_computation),
            Err(DependencyError::InvalidSignal(foreign_signal.id()))
        );
        assert_eq!(
            target.subscribe(local_signal, foreign_computation),
            Err(DependencyError::InvalidComputation(foreign_computation))
        );
        assert_eq!(
            target.unsubscribe(foreign_signal, local_computation),
            Err(DependencyError::InvalidSignal(foreign_signal.id()))
        );
        assert_eq!(
            target.replace_dependencies(foreign_computation, &[local_signal.id()]),
            Err(DependencyError::InvalidComputation(foreign_computation))
        );
        assert_eq!(
            target.dispose_computation(foreign_computation),
            Err(DependencyError::InvalidComputation(foreign_computation))
        );
        assert_eq!(
            target.replace_dependencies(local_computation, &[foreign_signal.id()]),
            Err(DependencyError::InvalidSignal(foreign_signal.id()))
        );
        assert_eq!(
            target.computation_slots[local_computation.index() as usize]
                .dependencies
                .as_ref(),
            Some(&vec![local_signal.id()])
        );

        target.dispose(local_signal).unwrap();
        target.dispose_computation(local_computation).unwrap();
        let replacement_signal = target.create_signal(3_u32).unwrap();
        assert_eq!(
            target.subscribe(replacement_signal, local_computation),
            Err(DependencyError::InvalidComputation(local_computation))
        );
        assert_eq!(
            target.subscribe(local_signal, foreign_computation),
            Err(DependencyError::InvalidSignal(local_signal.id()))
        );
        assert_eq!(
            target.subscribe(foreign_signal, local_computation),
            Err(DependencyError::InvalidSignal(foreign_signal.id()))
        );
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
