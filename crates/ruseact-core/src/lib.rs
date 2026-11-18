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

/// Errors returned when an explicit batch boundary is invalid.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BatchError {
    /// `end_batch` was called without a matching active batch.
    NotActive,
    /// The graph cannot represent one more nested batch level.
    DepthOverflow,
}

impl fmt::Display for BatchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotActive => formatter.write_str("no active reactive batch"),
            Self::DepthOverflow => formatter.write_str("reactive batch depth exhausted"),
        }
    }
}

impl std::error::Error for BatchError {}

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
/// M1.4 adds explicit nested batch boundaries to the M1.3 deterministic dirty
/// propagation and queue-drain API. The graph never executes computation
/// bodies or callbacks; a host may drain the IDs and decide how to process
/// them in a later milestone.
pub struct ReactiveGraph {
    graph_id: GraphId,
    slots: Vec<NodeSlot>,
    free_slots: Vec<u32>,
    active_nodes: usize,
    computation_slots: Vec<ComputationSlot>,
    free_computation_slots: Vec<u32>,
    active_computations: usize,
    pending_computations: Vec<ComputationId>,
    batch_depth: usize,
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
            batch_depth: 0,
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

    /// Begins an explicit batch.
    ///
    /// Dirty propagation still occurs for each changed signal, but pending
    /// computation IDs cannot be drained until the outermost matching
    /// [`Self::end_batch`] completes.
    pub fn begin_batch(&mut self) -> Result<(), BatchError> {
        self.batch_depth = self
            .batch_depth
            .checked_add(1)
            .ok_or(BatchError::DepthOverflow)?;
        Ok(())
    }

    /// Ends one explicit batch nesting level.
    ///
    /// Ending an inner batch keeps pending work gated by the outer batch.
    /// Ending the outermost batch makes existing pending work drainable; it
    /// does not execute or automatically drain any computation.
    pub fn end_batch(&mut self) -> Result<(), BatchError> {
        if self.batch_depth == 0 {
            return Err(BatchError::NotActive);
        }

        self.batch_depth -= 1;
        Ok(())
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
    /// execute a body, callback, render, batch, or other host work. While a
    /// batch is active, this returns an empty vector without consuming pending
    /// work or clearing dirty flags. A later changed signal may enqueue the
    /// same computation again after it has been drained.
    pub fn drain_pending_computations(&mut self) -> Vec<ComputationId> {
        if self.batch_depth != 0 {
            return Vec::new();
        }

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
    use std::collections::HashSet;

    use super::*;

    fn assert_graph_invariants(graph: &ReactiveGraph) {
        let mut live_nodes = 0;

        for (index, slot) in graph.slots.iter().enumerate() {
            let node_id = NodeId {
                graph_id: graph.graph_id,
                index: index as u32,
                generation: slot.generation,
            };

            if slot.value.is_some() {
                live_nodes += 1;
                for computation in &slot.subscribers {
                    assert_eq!(computation.graph_id, graph.graph_id);
                    let computation_slot = graph
                        .computation_slots
                        .get(computation.index as usize)
                        .expect("subscriber must reference an allocated slot");
                    assert_eq!(computation_slot.generation, computation.generation);
                    let dependencies = computation_slot
                        .dependencies
                        .as_ref()
                        .expect("subscriber must reference a live computation");
                    assert!(dependencies.contains(&node_id));
                }
            } else {
                assert!(slot.subscribers.is_empty());
            }
        }

        assert_eq!(live_nodes, graph.active_nodes);

        let pending: HashSet<_> = graph.pending_computations.iter().copied().collect();
        assert_eq!(pending.len(), graph.pending_computations.len());

        let mut live_computations = 0;
        for (index, slot) in graph.computation_slots.iter().enumerate() {
            let computation = ComputationId {
                graph_id: graph.graph_id,
                index: index as u32,
                generation: slot.generation,
            };

            if let Some(dependencies) = &slot.dependencies {
                live_computations += 1;
                assert_eq!(slot.dirty, pending.contains(&computation));

                for node_id in dependencies {
                    assert_eq!(node_id.graph_id, graph.graph_id);
                    let node_slot = graph
                        .slots
                        .get(node_id.index as usize)
                        .expect("dependency must reference an allocated slot");
                    assert_eq!(node_slot.generation, node_id.generation);
                    assert!(node_slot.value.is_some());
                    assert!(node_slot.subscribers.contains(&computation));
                }
            } else {
                assert!(!slot.dirty);
                assert!(!pending.contains(&computation));
            }
        }

        assert_eq!(live_computations, graph.active_computations);
        for computation in &graph.pending_computations {
            assert_eq!(computation.graph_id, graph.graph_id);
            let slot = graph
                .computation_slots
                .get(computation.index as usize)
                .expect("pending work must reference an allocated slot");
            assert_eq!(slot.generation, computation.generation);
            assert!(slot.dependencies.is_some());
            assert!(slot.dirty);
        }
    }

    struct ReferenceModel {
        values: Vec<u32>,
        subscribers: Vec<Vec<usize>>,
        pending: Vec<usize>,
        dirty: Vec<bool>,
    }

    fn apply_reference_set(
        graph: &mut ReactiveGraph,
        signal: Signal<u32>,
        signal_index: usize,
        value: u32,
        model: &mut ReferenceModel,
    ) {
        let expected = if model.values[signal_index] == value {
            SignalUpdate::Unchanged
        } else {
            SignalUpdate::Changed
        };
        assert_eq!(graph.set(signal, value), Ok(expected));

        if expected == SignalUpdate::Changed {
            model.values[signal_index] = value;
            for &computation_index in &model.subscribers[signal_index] {
                if !model.dirty[computation_index] {
                    model.dirty[computation_index] = true;
                    model.pending.push(computation_index);
                }
            }
        }
    }

    fn apply_reference_subscribe(
        graph: &mut ReactiveGraph,
        signal: Signal<u32>,
        signal_index: usize,
        computation: ComputationId,
        computation_index: usize,
        dependencies: &mut [Vec<usize>],
        subscribers: &mut [Vec<usize>],
    ) {
        let expected = !subscribers[signal_index].contains(&computation_index);
        assert_eq!(graph.subscribe(signal, computation), Ok(expected));
        if expected {
            subscribers[signal_index].push(computation_index);
            dependencies[computation_index].push(signal_index);
        }
    }

    fn apply_reference_unsubscribe(
        graph: &mut ReactiveGraph,
        signal: Signal<u32>,
        signal_index: usize,
        computation: ComputationId,
        computation_index: usize,
        dependencies: &mut [Vec<usize>],
        subscribers: &mut [Vec<usize>],
    ) {
        let expected = subscribers[signal_index].contains(&computation_index);
        assert_eq!(graph.unsubscribe(signal, computation), Ok(expected));
        if expected {
            subscribers[signal_index].retain(|index| *index != computation_index);
            dependencies[computation_index].retain(|index| *index != signal_index);
        }
    }

    fn apply_reference_replacement(
        graph: &mut ReactiveGraph,
        signals: &[Signal<u32>],
        computation: ComputationId,
        computation_index: usize,
        requested: &[usize],
        dependencies: &mut [Vec<usize>],
        subscribers: &mut [Vec<usize>],
    ) {
        let requested_ids: Vec<_> = requested.iter().map(|index| signals[*index].id()).collect();
        graph
            .replace_dependencies(computation, &requested_ids)
            .expect("all reference-model dependencies are valid");

        let mut next = Vec::new();
        for &signal_index in requested {
            if !next.contains(&signal_index) {
                next.push(signal_index);
            }
        }

        for signal_index in dependencies[computation_index].iter().copied() {
            subscribers[signal_index].retain(|index| *index != computation_index);
        }
        for &signal_index in &next {
            if !subscribers[signal_index].contains(&computation_index) {
                subscribers[signal_index].push(computation_index);
            }
        }
        dependencies[computation_index] = next;
    }

    #[derive(Clone, Copy)]
    struct DeterministicRng(u64);

    impl DeterministicRng {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0
        }
    }

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
    fn a_batch_accumulates_updates_until_the_outermost_end() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(0_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        graph.begin_batch().unwrap();
        assert_eq!(graph.set(signal, 1), Ok(SignalUpdate::Changed));
        assert_eq!(graph.set(signal, 2), Ok(SignalUpdate::Changed));
        assert_eq!(*graph.read(signal).unwrap(), 2);
        assert!(graph.drain_pending_computations().is_empty());

        graph.end_batch().unwrap();
        assert_eq!(graph.drain_pending_computations(), vec![computation]);
    }

    #[test]
    fn batch_preserves_order_for_shared_subscribers() {
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

        graph.begin_batch().unwrap();
        assert_eq!(graph.set(second_signal, 20), Ok(SignalUpdate::Changed));
        assert_eq!(graph.set(first_signal, 10), Ok(SignalUpdate::Changed));
        graph.end_batch().unwrap();

        assert_eq!(
            graph.drain_pending_computations(),
            vec![second, third, first]
        );
    }

    #[test]
    fn nested_batches_keep_pending_work_gated_until_outer_end() {
        let mut graph = ReactiveGraph::new();
        let first_signal = graph.create_signal(1_u32).unwrap();
        let second_signal = graph.create_signal(2_u32).unwrap();
        let first = graph.create_computation().unwrap();
        let second = graph.create_computation().unwrap();
        graph.subscribe(first_signal, first).unwrap();
        graph.subscribe(second_signal, second).unwrap();

        graph.begin_batch().unwrap();
        graph.set(first_signal, 10).unwrap();
        graph.begin_batch().unwrap();
        graph.set(second_signal, 20).unwrap();
        assert!(graph.drain_pending_computations().is_empty());
        graph.end_batch().unwrap();
        assert!(graph.drain_pending_computations().is_empty());
        graph.end_batch().unwrap();

        assert_eq!(graph.drain_pending_computations(), vec![first, second]);
    }

    #[test]
    fn draining_during_a_batch_preserves_work_and_dirty_state() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(0_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        graph.begin_batch().unwrap();
        graph.set(signal, 1).unwrap();
        assert!(graph.drain_pending_computations().is_empty());
        graph.set(signal, 2).unwrap();
        graph.end_batch().unwrap();

        assert_eq!(graph.drain_pending_computations(), vec![computation]);
        graph.set(signal, 3).unwrap();
        assert_eq!(graph.drain_pending_computations(), vec![computation]);
    }

    #[test]
    fn nested_batches_deduplicate_work_across_all_levels() {
        let mut graph = ReactiveGraph::new();
        let first_signal = graph.create_signal(1_u32).unwrap();
        let second_signal = graph.create_signal(2_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(first_signal, computation).unwrap();
        graph.subscribe(second_signal, computation).unwrap();

        graph.begin_batch().unwrap();
        graph.set(first_signal, 10).unwrap();
        graph.begin_batch().unwrap();
        graph.set(first_signal, 11).unwrap();
        graph.set(second_signal, 20).unwrap();
        graph.end_batch().unwrap();
        graph.set(second_signal, 21).unwrap();
        graph.end_batch().unwrap();

        assert_eq!(graph.drain_pending_computations(), vec![computation]);
    }

    #[test]
    fn unchanged_writes_inside_a_batch_do_not_create_work() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(String::from("same")).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        graph.begin_batch().unwrap();
        assert_eq!(
            graph.set(signal, String::from("same")),
            Ok(SignalUpdate::Unchanged)
        );
        graph.end_batch().unwrap();

        assert!(graph.drain_pending_computations().is_empty());
    }

    #[test]
    fn computation_disposal_during_a_batch_removes_pending_work() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(0_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        graph.begin_batch().unwrap();
        graph.set(signal, 1).unwrap();
        graph.dispose_computation(computation).unwrap();
        assert!(graph.drain_pending_computations().is_empty());
        graph.end_batch().unwrap();
        assert!(graph.drain_pending_computations().is_empty());
    }

    #[test]
    fn signal_disposal_during_a_batch_cleans_edges_and_keeps_live_work() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(0_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        graph.begin_batch().unwrap();
        graph.set(signal, 1).unwrap();
        graph.dispose(signal).unwrap();
        assert!(
            graph.computation_slots[computation.index() as usize]
                .dependencies
                .as_ref()
                .unwrap()
                .is_empty()
        );
        graph.end_batch().unwrap();

        assert_eq!(graph.drain_pending_computations(), vec![computation]);
    }

    #[test]
    fn invalid_batch_boundaries_preserve_graph_state() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(0_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        assert_eq!(graph.end_batch(), Err(BatchError::NotActive));
        assert_eq!(graph.set(signal, 1), Ok(SignalUpdate::Changed));

        graph.batch_depth = usize::MAX;
        assert_eq!(graph.begin_batch(), Err(BatchError::DepthOverflow));
        assert_eq!(graph.batch_depth, usize::MAX);
        graph.batch_depth = 0;

        assert_eq!(graph.drain_pending_computations(), vec![computation]);
    }

    #[test]
    fn consecutive_batches_and_outside_updates_remain_independent() {
        let mut graph = ReactiveGraph::new();
        let signal = graph.create_signal(0_u32).unwrap();
        let computation = graph.create_computation().unwrap();
        graph.subscribe(signal, computation).unwrap();

        graph.begin_batch().unwrap();
        graph.set(signal, 1).unwrap();
        graph.end_batch().unwrap();
        assert_eq!(graph.drain_pending_computations(), vec![computation]);

        graph.begin_batch().unwrap();
        graph.set(signal, 2).unwrap();
        graph.end_batch().unwrap();
        assert_eq!(graph.drain_pending_computations(), vec![computation]);

        graph.set(signal, 3).unwrap();
        assert_eq!(graph.drain_pending_computations(), vec![computation]);
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
    fn invalid_dependency_replacement_preserves_both_directions() {
        let mut graph = ReactiveGraph::new();
        let first = graph.create_signal(1_u32).unwrap();
        let second = graph.create_signal(2_u32).unwrap();
        let mut foreign_graph = ReactiveGraph::new();
        let foreign = foreign_graph.create_signal(3_u32).unwrap();
        let computation = graph.create_computation().unwrap();

        graph.subscribe(first, computation).unwrap();
        let before_dependencies = graph.computation_slots[computation.index() as usize]
            .dependencies
            .clone();
        let before_first_subscribers = graph.slots[first.id().index() as usize].subscribers.clone();
        let before_second_subscribers = graph.slots[second.id().index() as usize]
            .subscribers
            .clone();

        assert_eq!(
            graph.replace_dependencies(computation, &[second.id(), foreign.id()]),
            Err(DependencyError::InvalidSignal(foreign.id()))
        );
        assert_eq!(
            graph.computation_slots[computation.index() as usize].dependencies,
            before_dependencies
        );
        assert_eq!(
            graph.slots[first.id().index() as usize].subscribers,
            before_first_subscribers
        );
        assert_eq!(
            graph.slots[second.id().index() as usize].subscribers,
            before_second_subscribers
        );
        assert_graph_invariants(&graph);
    }

    #[test]
    fn deterministic_stress_matches_reference_model_and_preserves_invariants() {
        const COMPUTATION_COUNT: usize = 48;
        const OPERATION_COUNT: usize = 1_500;
        const SIGNAL_COUNT: usize = 96;

        let mut graph = ReactiveGraph::new();
        let signals: Vec<_> = (0..SIGNAL_COUNT)
            .map(|_| graph.create_signal(0_u32).unwrap())
            .collect();
        let computations: Vec<_> = (0..COMPUTATION_COUNT)
            .map(|_| graph.create_computation().unwrap())
            .collect();
        let mut model = ReferenceModel {
            values: vec![0_u32; SIGNAL_COUNT],
            subscribers: vec![Vec::new(); SIGNAL_COUNT],
            pending: Vec::new(),
            dirty: vec![false; COMPUTATION_COUNT],
        };
        let mut dependencies = vec![Vec::new(); COMPUTATION_COUNT];

        for computation_index in 0..COMPUTATION_COUNT {
            let initial = [
                (computation_index * 7) % SIGNAL_COUNT,
                (computation_index * 7 + 13) % SIGNAL_COUNT,
                (computation_index * 7 + 29) % SIGNAL_COUNT,
                (computation_index * 7 + 47) % SIGNAL_COUNT,
            ];
            for signal_index in initial {
                if !dependencies[computation_index].contains(&signal_index) {
                    apply_reference_subscribe(
                        &mut graph,
                        signals[signal_index],
                        signal_index,
                        computations[computation_index],
                        computation_index,
                        &mut dependencies,
                        &mut model.subscribers,
                    );
                }
            }
        }

        let mut rng = DeterministicRng(0x4d_31_35_76_65_72_69_66);
        for step in 0..OPERATION_COUNT {
            match rng.next() % 8 {
                0 | 1 => {
                    let signal_index = (rng.next() as usize) % SIGNAL_COUNT;
                    let value = if rng.next().is_multiple_of(5) {
                        model.values[signal_index]
                    } else {
                        (rng.next() as u32).wrapping_add(step as u32 + 1)
                    };
                    apply_reference_set(
                        &mut graph,
                        signals[signal_index],
                        signal_index,
                        value,
                        &mut model,
                    );
                }
                2 => {
                    let expected: Vec<_> = model
                        .pending
                        .drain(..)
                        .map(|index| computations[index])
                        .collect();
                    for computation_index in &expected {
                        model.dirty[computation_index.index() as usize] = false;
                    }
                    assert_eq!(graph.drain_pending_computations(), expected);
                }
                3 => {
                    let computation_index = (rng.next() as usize) % COMPUTATION_COUNT;
                    let requested_len = (rng.next() as usize) % 9;
                    let requested: Vec<_> = (0..requested_len)
                        .map(|offset| (rng.next() as usize + offset * 11) % SIGNAL_COUNT)
                        .collect();
                    apply_reference_replacement(
                        &mut graph,
                        &signals,
                        computations[computation_index],
                        computation_index,
                        &requested,
                        &mut dependencies,
                        &mut model.subscribers,
                    );
                }
                4 => {
                    let signal_index = (rng.next() as usize) % SIGNAL_COUNT;
                    let computation_index = (rng.next() as usize) % COMPUTATION_COUNT;
                    if rng.next() & 1 == 0 {
                        apply_reference_subscribe(
                            &mut graph,
                            signals[signal_index],
                            signal_index,
                            computations[computation_index],
                            computation_index,
                            &mut dependencies,
                            &mut model.subscribers,
                        );
                    } else {
                        apply_reference_unsubscribe(
                            &mut graph,
                            signals[signal_index],
                            signal_index,
                            computations[computation_index],
                            computation_index,
                            &mut dependencies,
                            &mut model.subscribers,
                        );
                    }
                }
                5 => {
                    graph.begin_batch().unwrap();
                    for offset in 0..3 {
                        let signal_index = (rng.next() as usize + offset) % SIGNAL_COUNT;
                        let value = (rng.next() as u32).wrapping_add(step as u32);
                        apply_reference_set(
                            &mut graph,
                            signals[signal_index],
                            signal_index,
                            value,
                            &mut model,
                        );
                    }
                    assert!(graph.drain_pending_computations().is_empty());
                    graph.begin_batch().unwrap();
                    let signal_index = (rng.next() as usize) % SIGNAL_COUNT;
                    let value = (rng.next() as u32).wrapping_add(1);
                    apply_reference_set(
                        &mut graph,
                        signals[signal_index],
                        signal_index,
                        value,
                        &mut model,
                    );
                    assert!(graph.drain_pending_computations().is_empty());
                    graph.end_batch().unwrap();
                    assert!(graph.drain_pending_computations().is_empty());
                    graph.end_batch().unwrap();
                }
                6 => {
                    let signal_index = (rng.next() as usize) % SIGNAL_COUNT;
                    assert_eq!(
                        *graph.read(signals[signal_index]).unwrap(),
                        model.values[signal_index]
                    );
                }
                _ => {
                    let signal_index = (rng.next() as usize) % SIGNAL_COUNT;
                    for offset in 0..4 {
                        let value = model.values[signal_index].wrapping_add(offset + 1);
                        apply_reference_set(
                            &mut graph,
                            signals[signal_index],
                            signal_index,
                            value,
                            &mut model,
                        );
                    }
                }
            }

            assert_graph_invariants(&graph);
        }

        let expected: Vec<_> = model
            .pending
            .drain(..)
            .map(|index| computations[index])
            .collect();
        for computation_index in &expected {
            model.dirty[computation_index.index() as usize] = false;
        }
        assert_eq!(graph.drain_pending_computations(), expected);
        assert_graph_invariants(&graph);
    }

    #[test]
    fn lifecycle_churn_preserves_generations_cleanup_and_graph_isolation() {
        const CYCLES: usize = 256;

        let mut graph = ReactiveGraph::new();
        let mut foreign_graph = ReactiveGraph::new();
        let foreign_signal = foreign_graph.create_signal(0_u32).unwrap();
        let mut previous_signal: Option<Signal<u32>> = None;
        let mut previous_computation: Option<ComputationId> = None;

        for cycle in 0..CYCLES {
            let signal = graph.create_signal(cycle as u32).unwrap();
            let computation = graph.create_computation().unwrap();
            graph.subscribe(signal, computation).unwrap();

            if cycle % 2 == 0 {
                graph.begin_batch().unwrap();
                graph.set(signal, cycle as u32 + 1).unwrap();
                assert!(graph.drain_pending_computations().is_empty());
                graph.end_batch().unwrap();
            } else {
                graph.set(signal, cycle as u32 + 1).unwrap();
            }

            assert_eq!(
                graph.set(foreign_signal, cycle as u32 + 1),
                Err(SignalError::InvalidNode(foreign_signal.id()))
            );
            assert_graph_invariants(&graph);

            graph.dispose_computation(computation).unwrap();
            graph.dispose(signal).unwrap();
            assert!(graph.drain_pending_computations().is_empty());
            assert_graph_invariants(&graph);

            if let Some(previous_signal) = previous_signal {
                assert_eq!(signal.id().index(), previous_signal.id().index());
                assert_eq!(
                    signal.id().generation(),
                    previous_signal.id().generation() + 1
                );
            }
            if let Some(previous_computation) = previous_computation {
                assert_eq!(computation.index(), previous_computation.index());
                assert_eq!(
                    computation.generation(),
                    previous_computation.generation() + 1
                );
            }

            assert_eq!(
                graph.read(signal),
                Err(SignalError::InvalidNode(signal.id()))
            );
            previous_signal = Some(signal);
            previous_computation = Some(computation);
        }

        assert!(graph.is_empty());
        assert_eq!(graph.active_computations, 0);
        assert_graph_invariants(&graph);
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
