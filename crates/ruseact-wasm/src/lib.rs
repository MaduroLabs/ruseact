#![forbid(unsafe_code)]
#![doc = "Thin RustReactiveCore to JavaScript/WASM bridge for Ruseact."]

use ruseact_core::{
    BatchError, ComputationId, DependencyError, GraphError, NodeId, ReactiveGraph, Signal,
    SignalError, SignalUpdate,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use js_sys::{Object, Reflect, Uint32Array};

static NEXT_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum ResourceKind {
    Signal = 1,
    Computation = 2,
}

impl ResourceKind {
    #[cfg(target_arch = "wasm32")]
    const fn as_str(self) -> &'static str {
        match self {
            Self::Signal => "signal",
            Self::Computation => "computation",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct HandleIdentity {
    instance_id: u64,
    graph_id: u64,
    kind: ResourceKind,
    index: u32,
    generation: u32,
}

/// An opaque resource handle returned by the bridge.
///
/// The fields are deliberately private. JavaScript can retain and pass this
/// object back to the same bridge instance, but cannot construct a trusted
/// handle by supplying slot or generation fields. Every operation validates
/// the fields against the owning instance and graph before calling the core.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct WasmHandle {
    instance_id: u64,
    graph_id: u64,
    kind: u8,
    index: u32,
    generation: u32,
}

impl WasmHandle {
    const fn identity(self) -> Result<HandleIdentity, BridgeError> {
        let kind = match self.kind {
            1 => ResourceKind::Signal,
            2 => ResourceKind::Computation,
            _ => return Err(BridgeError::invalid_argument("handle_kind")),
        };

        Ok(HandleIdentity {
            instance_id: self.instance_id,
            graph_id: self.graph_id,
            kind,
            index: self.index,
            generation: self.generation,
        })
    }
}

/// An opaque, instance-bound collection used for atomic dependency replacement.
///
/// A JavaScript array cannot safely be downcast back into exported Rust handle
/// classes by wasm-bindgen. This list keeps the dependency operation typed and
/// preserves the owning instance before `WasmCore` performs its live-generation
/// validation.
#[wasm_bindgen]
pub struct WasmDependencyList {
    instance_id: u64,
    graph_id: u64,
    handles: Vec<WasmHandle>,
}

#[wasm_bindgen]
impl WasmDependencyList {
    pub fn push(&mut self, signal: &WasmHandle) -> Result<(), JsValue> {
        let identity = signal.identity().map_err(BridgeError::to_js)?;
        if identity.instance_id != self.instance_id {
            return Err(BridgeError::with_handle(
                "foreign_instance",
                "dependency_list_push",
                ResourceKind::Signal,
                identity.index,
                identity.generation,
            )
            .to_js());
        }
        if identity.graph_id != self.graph_id {
            return Err(BridgeError::with_handle(
                "invalid_graph",
                "dependency_list_push",
                ResourceKind::Signal,
                identity.index,
                identity.generation,
            )
            .to_js());
        }
        if identity.kind != ResourceKind::Signal {
            return Err(BridgeError::with_handle(
                "invalid_signal",
                "dependency_list_push",
                ResourceKind::Signal,
                identity.index,
                identity.generation,
            )
            .to_js());
        }
        self.handles.push(*signal);
        Ok(())
    }

    pub fn clear(&mut self) {
        self.handles.clear();
    }

    pub fn len(&self) -> usize {
        self.handles.len()
    }

    pub fn is_empty(&self) -> bool {
        self.handles.is_empty()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct BridgeError {
    code: &'static str,
    operation: &'static str,
    resource: Option<ResourceKind>,
    index: Option<u32>,
    generation: Option<u32>,
}

impl BridgeError {
    const fn simple(code: &'static str, operation: &'static str) -> Self {
        Self {
            code,
            operation,
            resource: None,
            index: None,
            generation: None,
        }
    }

    const fn invalid_argument(operation: &'static str) -> Self {
        Self::simple("invalid_argument", operation)
    }

    const fn with_handle(
        code: &'static str,
        operation: &'static str,
        kind: ResourceKind,
        index: u32,
        generation: u32,
    ) -> Self {
        Self {
            code,
            operation,
            resource: Some(kind),
            index: Some(index),
            generation: Some(generation),
        }
    }

    fn to_js(self) -> JsValue {
        #[cfg(target_arch = "wasm32")]
        {
            let object = Object::new();
            let fields = [
                ("code", JsValue::from_str(self.code)),
                ("operation", JsValue::from_str(self.operation)),
            ];

            for (name, value) in fields {
                if Reflect::set(&object, &JsValue::from_str(name), &value).is_err() {
                    return JsValue::from_str("internal_invariant");
                }
            }

            if let Some(resource) = self.resource {
                if Reflect::set(
                    &object,
                    &JsValue::from_str("resource"),
                    &JsValue::from_str(resource.as_str()),
                )
                .is_err()
                {
                    return JsValue::from_str("internal_invariant");
                }
            }
            if let Some(index) = self.index {
                if Reflect::set(
                    &object,
                    &JsValue::from_str("index"),
                    &JsValue::from_f64(f64::from(index)),
                )
                .is_err()
                {
                    return JsValue::from_str("internal_invariant");
                }
            }
            if let Some(generation) = self.generation {
                if Reflect::set(
                    &object,
                    &JsValue::from_str("generation"),
                    &JsValue::from_f64(f64::from(generation)),
                )
                .is_err()
                {
                    return JsValue::from_str("internal_invariant");
                }
            }

            object.into()
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            JsValue::from_str(self.code)
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy)]
enum SignalRecord {
    Bool(Signal<bool>),
    Number(Signal<f64>),
    String(Signal<String>),
}

impl SignalRecord {
    const fn node_id(self) -> NodeId {
        match self {
            Self::Bool(signal) => signal.id(),
            Self::Number(signal) => signal.id(),
            Self::String(signal) => signal.id(),
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
enum ScalarValue {
    Bool(bool),
    Number(f64),
    String(String),
}

/// One bridge-owned graph and its opaque handle registry.
///
/// The bridge owns the graph and all typed signal handles. Dropping this
/// value releases the graph. JavaScript must call `dispose` explicitly for
/// deterministic lifecycle behavior; no finalizer is used for correctness.
#[wasm_bindgen]
pub struct WasmCore {
    instance_id: u64,
    graph_id: u64,
    graph: Option<ReactiveGraph>,
    signals: HashMap<HandleIdentity, SignalRecord>,
    computations: HashMap<HandleIdentity, ComputationId>,
}

impl WasmCore {
    fn allocate_instance_id() -> Result<u64, BridgeError> {
        let mut current = NEXT_INSTANCE_ID.load(Ordering::Relaxed);
        loop {
            let next = current
                .checked_add(1)
                .ok_or(BridgeError::simple("resource_exhausted", "create_core"))?;
            match NEXT_INSTANCE_ID.compare_exchange_weak(
                current,
                next,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Ok(current),
                Err(observed) => current = observed,
            }
        }
    }

    fn new_internal() -> Result<Self, BridgeError> {
        let graph =
            ReactiveGraph::try_new().map_err(|error| map_graph_error(error, "create_core"))?;
        let graph_id = graph.graph_id().as_u64();
        let instance_id = Self::allocate_instance_id()?;
        Ok(Self {
            instance_id,
            graph_id,
            graph: Some(graph),
            signals: HashMap::new(),
            computations: HashMap::new(),
        })
    }

    fn ensure_active(&self, operation: &'static str) -> Result<(), BridgeError> {
        if self.graph.is_some() {
            Ok(())
        } else {
            Err(BridgeError::simple("disposed_instance", operation))
        }
    }

    fn handle_for(&self, kind: ResourceKind, index: u32, generation: u32) -> WasmHandle {
        WasmHandle {
            instance_id: self.instance_id,
            graph_id: self.graph_id,
            kind: kind as u8,
            index,
            generation,
        }
    }

    fn validate_identity(
        &self,
        handle: &WasmHandle,
        expected: ResourceKind,
        operation: &'static str,
    ) -> Result<HandleIdentity, BridgeError> {
        self.ensure_active(operation)?;
        let identity = handle.identity()?;
        if identity.instance_id != self.instance_id {
            return Err(BridgeError::with_handle(
                "foreign_instance",
                operation,
                expected,
                identity.index,
                identity.generation,
            ));
        }
        if identity.graph_id != self.graph_id {
            return Err(BridgeError::with_handle(
                "invalid_graph",
                operation,
                expected,
                identity.index,
                identity.generation,
            ));
        }
        if identity.kind != expected {
            return Err(BridgeError::with_handle(
                match expected {
                    ResourceKind::Signal => "invalid_signal",
                    ResourceKind::Computation => "invalid_computation",
                },
                operation,
                expected,
                identity.index,
                identity.generation,
            ));
        }
        Ok(identity)
    }

    fn validate_signal(
        &self,
        handle: &WasmHandle,
        operation: &'static str,
    ) -> Result<(HandleIdentity, SignalRecord), BridgeError> {
        let identity = self.validate_identity(handle, ResourceKind::Signal, operation)?;
        let record = self.signals.get(&identity).copied().ok_or_else(|| {
            BridgeError::with_handle(
                "stale_handle",
                operation,
                ResourceKind::Signal,
                identity.index,
                identity.generation,
            )
        })?;
        if record.node_id().index() != identity.index
            || record.node_id().generation() != identity.generation
            || record.node_id().graph_id().as_u64() != identity.graph_id
        {
            return Err(BridgeError::simple("internal_invariant", operation));
        }
        Ok((identity, record))
    }

    fn validate_computation(
        &self,
        handle: &WasmHandle,
        operation: &'static str,
    ) -> Result<(HandleIdentity, ComputationId), BridgeError> {
        let identity = self.validate_identity(handle, ResourceKind::Computation, operation)?;
        let computation = self.computations.get(&identity).copied().ok_or_else(|| {
            BridgeError::with_handle(
                "stale_handle",
                operation,
                ResourceKind::Computation,
                identity.index,
                identity.generation,
            )
        })?;
        if computation.index() != identity.index
            || computation.generation() != identity.generation
            || computation.graph_id().as_u64() != identity.graph_id
        {
            return Err(BridgeError::simple("internal_invariant", operation));
        }
        Ok((identity, computation))
    }

    #[allow(dead_code)]
    fn create_scalar(&mut self, value: ScalarValue) -> Result<WasmHandle, BridgeError> {
        self.ensure_active("create_signal")?;
        let (record, node_id) = {
            let graph = self
                .graph
                .as_mut()
                .ok_or(BridgeError::simple("disposed_instance", "create_signal"))?;
            match value {
                ScalarValue::Bool(value) => {
                    let signal = graph
                        .create_signal(value)
                        .map_err(|error| map_signal_error(error, "create_signal"))?;
                    (SignalRecord::Bool(signal), signal.id())
                }
                ScalarValue::Number(value) => {
                    let signal = graph
                        .create_signal(value)
                        .map_err(|error| map_signal_error(error, "create_signal"))?;
                    (SignalRecord::Number(signal), signal.id())
                }
                ScalarValue::String(value) => {
                    let signal = graph
                        .create_signal(value)
                        .map_err(|error| map_signal_error(error, "create_signal"))?;
                    (SignalRecord::String(signal), signal.id())
                }
            }
        };
        let identity = HandleIdentity {
            instance_id: self.instance_id,
            graph_id: node_id.graph_id().as_u64(),
            kind: ResourceKind::Signal,
            index: node_id.index(),
            generation: node_id.generation(),
        };
        self.signals.insert(identity, record);
        Ok(self.handle_for(ResourceKind::Signal, node_id.index(), node_id.generation()))
    }

    #[allow(dead_code)]
    fn read_scalar(&self, handle: &WasmHandle) -> Result<ScalarValue, BridgeError> {
        let (_, record) = self.validate_signal(handle, "read_signal")?;
        let graph = self
            .graph
            .as_ref()
            .ok_or(BridgeError::simple("disposed_instance", "read_signal"))?;
        match record {
            SignalRecord::Bool(signal) => graph
                .read(signal)
                .copied()
                .map(ScalarValue::Bool)
                .map_err(|error| map_signal_error(error, "read_signal")),
            SignalRecord::Number(signal) => graph
                .read(signal)
                .copied()
                .map(ScalarValue::Number)
                .map_err(|error| map_signal_error(error, "read_signal")),
            SignalRecord::String(signal) => graph
                .read(signal)
                .cloned()
                .map(ScalarValue::String)
                .map_err(|error| map_signal_error(error, "read_signal")),
        }
    }

    #[allow(dead_code)]
    fn set_scalar(&mut self, handle: &WasmHandle, value: ScalarValue) -> Result<bool, BridgeError> {
        let (_, record) = self.validate_signal(handle, "set_signal")?;
        let graph = self
            .graph
            .as_mut()
            .ok_or(BridgeError::simple("disposed_instance", "set_signal"))?;
        let changed = match (record, value) {
            (SignalRecord::Bool(signal), ScalarValue::Bool(value)) => graph
                .set(signal, value)
                .map_err(|error| map_signal_error(error, "set_signal"))?,
            (SignalRecord::Number(signal), ScalarValue::Number(value)) => graph
                .set(signal, value)
                .map_err(|error| map_signal_error(error, "set_signal"))?,
            (SignalRecord::String(signal), ScalarValue::String(value)) => graph
                .set(signal, value)
                .map_err(|error| map_signal_error(error, "set_signal"))?,
            (_, _) => return Err(BridgeError::simple("type_mismatch", "set_signal")),
        };
        Ok(matches!(changed, SignalUpdate::Changed))
    }

    fn dispose_signal_internal(&mut self, handle: &WasmHandle) -> Result<(), BridgeError> {
        let (identity, record) = self.validate_signal(handle, "dispose_signal")?;
        let graph = self
            .graph
            .as_mut()
            .ok_or(BridgeError::simple("disposed_instance", "dispose_signal"))?;
        match record {
            SignalRecord::Bool(signal) => graph
                .dispose(signal)
                .map_err(|error| map_signal_error(error, "dispose_signal"))?,
            SignalRecord::Number(signal) => graph
                .dispose(signal)
                .map_err(|error| map_signal_error(error, "dispose_signal"))?,
            SignalRecord::String(signal) => graph
                .dispose(signal)
                .map_err(|error| map_signal_error(error, "dispose_signal"))?,
        }
        self.signals.remove(&identity);
        Ok(())
    }

    fn create_computation_internal(&mut self) -> Result<WasmHandle, BridgeError> {
        self.ensure_active("create_computation")?;
        let computation = self
            .graph
            .as_mut()
            .ok_or(BridgeError::simple(
                "disposed_instance",
                "create_computation",
            ))?
            .create_computation()
            .map_err(|error| map_dependency_error(error, "create_computation"))?;
        let identity = HandleIdentity {
            instance_id: self.instance_id,
            graph_id: computation.graph_id().as_u64(),
            kind: ResourceKind::Computation,
            index: computation.index(),
            generation: computation.generation(),
        };
        self.computations.insert(identity, computation);
        Ok(self.handle_for(
            ResourceKind::Computation,
            computation.index(),
            computation.generation(),
        ))
    }

    fn dispose_computation_internal(&mut self, handle: &WasmHandle) -> Result<(), BridgeError> {
        let (identity, computation) = self.validate_computation(handle, "dispose_computation")?;
        self.graph
            .as_mut()
            .ok_or(BridgeError::simple(
                "disposed_instance",
                "dispose_computation",
            ))?
            .dispose_computation(computation)
            .map_err(|error| map_dependency_error(error, "dispose_computation"))?;
        self.computations.remove(&identity);
        Ok(())
    }

    fn subscribe_internal(
        &mut self,
        signal: &WasmHandle,
        computation: &WasmHandle,
    ) -> Result<bool, BridgeError> {
        let (_, signal) = self.validate_signal(signal, "subscribe")?;
        let (_, computation) = self.validate_computation(computation, "subscribe")?;
        let graph = self
            .graph
            .as_mut()
            .ok_or(BridgeError::simple("disposed_instance", "subscribe"))?;
        match signal {
            SignalRecord::Bool(signal) => graph
                .subscribe(signal, computation)
                .map_err(|error| map_dependency_error(error, "subscribe")),
            SignalRecord::Number(signal) => graph
                .subscribe(signal, computation)
                .map_err(|error| map_dependency_error(error, "subscribe")),
            SignalRecord::String(signal) => graph
                .subscribe(signal, computation)
                .map_err(|error| map_dependency_error(error, "subscribe")),
        }
    }

    fn unsubscribe_internal(
        &mut self,
        signal: &WasmHandle,
        computation: &WasmHandle,
    ) -> Result<bool, BridgeError> {
        let (_, signal) = self.validate_signal(signal, "unsubscribe")?;
        let (_, computation) = self.validate_computation(computation, "unsubscribe")?;
        let graph = self
            .graph
            .as_mut()
            .ok_or(BridgeError::simple("disposed_instance", "unsubscribe"))?;
        match signal {
            SignalRecord::Bool(signal) => graph
                .unsubscribe(signal, computation)
                .map_err(|error| map_dependency_error(error, "unsubscribe")),
            SignalRecord::Number(signal) => graph
                .unsubscribe(signal, computation)
                .map_err(|error| map_dependency_error(error, "unsubscribe")),
            SignalRecord::String(signal) => graph
                .unsubscribe(signal, computation)
                .map_err(|error| map_dependency_error(error, "unsubscribe")),
        }
    }

    #[allow(dead_code)]
    fn replace_dependencies_internal(
        &mut self,
        computation: &WasmHandle,
        dependencies: &[WasmHandle],
    ) -> Result<(), BridgeError> {
        let (_, computation) = self.validate_computation(computation, "replace_dependencies")?;
        let mut node_ids = Vec::with_capacity(dependencies.len());
        for dependency in dependencies {
            let (_, signal) = self.validate_signal(dependency, "replace_dependencies")?;
            node_ids.push(signal.node_id());
        }
        self.graph
            .as_mut()
            .ok_or(BridgeError::simple(
                "disposed_instance",
                "replace_dependencies",
            ))?
            .replace_dependencies(computation, &node_ids)
            .map_err(|error| map_dependency_error(error, "replace_dependencies"))
    }

    #[allow(dead_code)]
    fn drain_pending_pairs(&mut self) -> Result<Vec<u32>, BridgeError> {
        self.ensure_active("drain_pending_computations")?;
        let pending = self
            .graph
            .as_mut()
            .ok_or(BridgeError::simple(
                "disposed_instance",
                "drain_pending_computations",
            ))?
            .drain_pending_computations();
        let mut pairs = Vec::with_capacity(pending.len().saturating_mul(2));
        for computation in pending {
            let identity = HandleIdentity {
                instance_id: self.instance_id,
                graph_id: computation.graph_id().as_u64(),
                kind: ResourceKind::Computation,
                index: computation.index(),
                generation: computation.generation(),
            };
            if !self.computations.contains_key(&identity) {
                return Err(BridgeError::simple(
                    "internal_invariant",
                    "drain_pending_computations",
                ));
            }
            pairs.push(computation.index());
            pairs.push(computation.generation());
        }
        Ok(pairs)
    }

    #[cfg(test)]
    fn error_code(error: Result<(), BridgeError>) -> Option<&'static str> {
        error.err().map(|error| error.code)
    }

    fn dispose_internal(&mut self) -> Result<(), BridgeError> {
        if self.graph.is_none() {
            return Err(BridgeError::simple("disposed_instance", "dispose"));
        }
        self.graph.take();
        self.signals.clear();
        self.computations.clear();
        Ok(())
    }
}

#[wasm_bindgen]
impl WasmCore {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<WasmCore, JsValue> {
        Self::new_internal().map_err(BridgeError::to_js)
    }

    /// Returns whether explicit graph disposal has occurred.
    #[wasm_bindgen(getter)]
    pub fn disposed(&self) -> bool {
        self.graph.is_none()
    }

    /// Explicitly drops the bridge-owned graph and all registered handles.
    pub fn dispose(&mut self) -> Result<(), JsValue> {
        self.dispose_internal().map_err(BridgeError::to_js)
    }

    #[cfg(target_arch = "wasm32")]
    pub fn create_signal(&mut self, value: JsValue) -> Result<WasmHandle, JsValue> {
        let value = scalar_from_js(&value).map_err(BridgeError::to_js)?;
        self.create_scalar(value).map_err(BridgeError::to_js)
    }

    #[cfg(target_arch = "wasm32")]
    pub fn read_signal(&self, signal: &WasmHandle) -> Result<JsValue, JsValue> {
        let value = self.read_scalar(signal).map_err(BridgeError::to_js)?;
        Ok(scalar_to_js(value))
    }

    #[cfg(target_arch = "wasm32")]
    pub fn set_signal(&mut self, signal: &WasmHandle, value: JsValue) -> Result<bool, JsValue> {
        let (_, record) = self
            .validate_signal(signal, "set_signal")
            .map_err(BridgeError::to_js)?;
        let value = scalar_from_js(&value).map_err(BridgeError::to_js)?;
        if !matches!(
            (&record, &value),
            (SignalRecord::Bool(_), ScalarValue::Bool(_))
                | (SignalRecord::Number(_), ScalarValue::Number(_))
                | (SignalRecord::String(_), ScalarValue::String(_))
        ) {
            return Err(BridgeError::simple("type_mismatch", "set_signal").to_js());
        }
        self.set_scalar(signal, value).map_err(BridgeError::to_js)
    }

    pub fn dispose_signal(&mut self, signal: &WasmHandle) -> Result<(), JsValue> {
        self.dispose_signal_internal(signal)
            .map_err(BridgeError::to_js)
    }

    pub fn create_computation(&mut self) -> Result<WasmHandle, JsValue> {
        self.create_computation_internal()
            .map_err(BridgeError::to_js)
    }

    pub fn dispose_computation(&mut self, computation: &WasmHandle) -> Result<(), JsValue> {
        self.dispose_computation_internal(computation)
            .map_err(BridgeError::to_js)
    }

    pub fn dispose_resource(&mut self, handle: &WasmHandle) -> Result<(), JsValue> {
        let identity = handle.identity().map_err(BridgeError::to_js)?;
        match identity.kind {
            ResourceKind::Signal => self.dispose_signal(handle),
            ResourceKind::Computation => self.dispose_computation(handle),
        }
    }

    pub fn create_dependency_list(&self) -> Result<WasmDependencyList, JsValue> {
        self.ensure_active("create_dependency_list")
            .map_err(BridgeError::to_js)?;
        Ok(WasmDependencyList {
            instance_id: self.instance_id,
            graph_id: self.graph_id,
            handles: Vec::new(),
        })
    }

    pub fn subscribe(
        &mut self,
        signal: &WasmHandle,
        computation: &WasmHandle,
    ) -> Result<bool, JsValue> {
        self.subscribe_internal(signal, computation)
            .map_err(BridgeError::to_js)
    }

    pub fn unsubscribe(
        &mut self,
        signal: &WasmHandle,
        computation: &WasmHandle,
    ) -> Result<bool, JsValue> {
        self.unsubscribe_internal(signal, computation)
            .map_err(BridgeError::to_js)
    }

    pub fn replace_dependencies(
        &mut self,
        computation: &WasmHandle,
        dependencies: &WasmDependencyList,
    ) -> Result<(), JsValue> {
        self.ensure_active("replace_dependencies")
            .map_err(BridgeError::to_js)?;
        if dependencies.instance_id != self.instance_id {
            return Err(BridgeError::simple("foreign_instance", "replace_dependencies").to_js());
        }
        if dependencies.graph_id != self.graph_id {
            return Err(BridgeError::simple("invalid_graph", "replace_dependencies").to_js());
        }
        self.replace_dependencies_internal(computation, &dependencies.handles)
            .map_err(BridgeError::to_js)
    }

    pub fn begin_batch(&mut self) -> Result<(), JsValue> {
        self.ensure_active("begin_batch")
            .and_then(|_| {
                self.graph
                    .as_mut()
                    .ok_or(BridgeError::simple("disposed_instance", "begin_batch"))?
                    .begin_batch()
                    .map_err(|error| map_batch_error(error, "begin_batch"))
            })
            .map_err(BridgeError::to_js)
    }

    pub fn end_batch(&mut self) -> Result<(), JsValue> {
        self.ensure_active("end_batch")
            .and_then(|_| {
                self.graph
                    .as_mut()
                    .ok_or(BridgeError::simple("disposed_instance", "end_batch"))?
                    .end_batch()
                    .map_err(|error| map_batch_error(error, "end_batch"))
            })
            .map_err(BridgeError::to_js)
    }

    #[cfg(target_arch = "wasm32")]
    pub fn drain_pending_computations(&mut self) -> Result<Uint32Array, JsValue> {
        let pairs = self.drain_pending_pairs().map_err(BridgeError::to_js)?;
        Ok(Uint32Array::from(pairs.as_slice()))
    }
}

#[allow(dead_code)]
fn scalar_from_js(value: &JsValue) -> Result<ScalarValue, BridgeError> {
    if let Some(value) = value.as_bool() {
        return Ok(ScalarValue::Bool(value));
    }
    if let Some(value) = value.as_f64() {
        return scalar_from_number(value);
    }
    if let Some(value) = value.as_string() {
        return Ok(ScalarValue::String(value));
    }
    Err(BridgeError::simple("unsupported_value", "scalar_value"))
}

fn scalar_from_number(value: f64) -> Result<ScalarValue, BridgeError> {
    if value.is_finite() {
        Ok(ScalarValue::Number(value))
    } else {
        Err(BridgeError::simple("unsupported_value", "scalar_value"))
    }
}

#[cfg(target_arch = "wasm32")]
fn scalar_to_js(value: ScalarValue) -> JsValue {
    match value {
        ScalarValue::Bool(value) => JsValue::from_bool(value),
        ScalarValue::Number(value) => JsValue::from_f64(value),
        ScalarValue::String(value) => JsValue::from_str(&value),
    }
}

fn map_graph_error(error: GraphError, operation: &'static str) -> BridgeError {
    match error {
        GraphError::IdExhausted => BridgeError::simple("graph_id_exhausted", operation),
    }
}

fn map_signal_error(error: SignalError, operation: &'static str) -> BridgeError {
    match error {
        SignalError::InvalidNode(node) => BridgeError::with_handle(
            "invalid_signal",
            operation,
            ResourceKind::Signal,
            node.index(),
            node.generation(),
        ),
        SignalError::TypeMismatch(node) => BridgeError::with_handle(
            "type_mismatch",
            operation,
            ResourceKind::Signal,
            node.index(),
            node.generation(),
        ),
        SignalError::NodeIdExhausted => BridgeError::simple("node_id_exhausted", operation),
    }
}

fn map_dependency_error(error: DependencyError, operation: &'static str) -> BridgeError {
    match error {
        DependencyError::InvalidSignal(node) => BridgeError::with_handle(
            "invalid_signal",
            operation,
            ResourceKind::Signal,
            node.index(),
            node.generation(),
        ),
        DependencyError::InvalidComputation(computation) => BridgeError::with_handle(
            "invalid_computation",
            operation,
            ResourceKind::Computation,
            computation.index(),
            computation.generation(),
        ),
        DependencyError::ComputationIdExhausted => {
            BridgeError::simple("computation_id_exhausted", operation)
        }
    }
}

fn map_batch_error(error: BatchError, operation: &'static str) -> BridgeError {
    match error {
        BatchError::NotActive => BridgeError::simple("batch_not_active", operation),
        BatchError::DepthOverflow => BridgeError::simple("batch_depth_overflow", operation),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn number_signal(core: &mut WasmCore, value: f64) -> WasmHandle {
        core.create_scalar(ScalarValue::Number(value)).unwrap()
    }

    #[test]
    fn graph_lifecycle_is_explicit_and_idempotency_is_safe() {
        let mut core = WasmCore::new_internal().unwrap();
        assert!(!core.graph.is_none());
        core.dispose().unwrap();
        assert!(core.graph.is_none());
        assert_eq!(
            WasmCore::error_code(core.dispose_internal()),
            Some("disposed_instance")
        );
    }

    #[test]
    fn scalar_round_trip_and_equality_preserve_core_behavior() {
        let mut core = WasmCore::new_internal().unwrap();
        let number = number_signal(&mut core, 0.0);
        assert_eq!(core.read_scalar(&number).unwrap(), ScalarValue::Number(0.0));
        assert!(!core.set_scalar(&number, ScalarValue::Number(-0.0)).unwrap());
        assert!(core.set_scalar(&number, ScalarValue::Number(1.0)).unwrap());
        assert_eq!(
            WasmCore::error_code(scalar_from_number(f64::NAN).map(|_| ())),
            Some("unsupported_value")
        );
    }

    #[test]
    fn handles_are_isolated_by_instance_and_generation() {
        let mut first = WasmCore::new_internal().unwrap();
        let mut second = WasmCore::new_internal().unwrap();
        let handle = number_signal(&mut first, 1.0);
        assert_eq!(
            WasmCore::error_code(second.dispose_signal_internal(&handle)),
            Some("foreign_instance")
        );
        first.dispose_signal_internal(&handle).unwrap();
        assert_eq!(
            WasmCore::error_code(first.dispose_signal_internal(&handle)),
            Some("stale_handle")
        );
    }

    #[test]
    fn dependency_and_batch_operations_preserve_core_semantics() {
        let mut core = WasmCore::new_internal().unwrap();
        let signal = number_signal(&mut core, 0.0);
        let computation = core.create_computation_internal().unwrap();
        assert!(core.subscribe_internal(&signal, &computation).unwrap());
        assert!(!core.subscribe_internal(&signal, &computation).unwrap());
        core.begin_batch().unwrap();
        assert!(core.set_scalar(&signal, ScalarValue::Number(1.0)).unwrap());
        assert!(core.drain_pending_pairs().unwrap().is_empty());
        core.end_batch().unwrap();
        assert_eq!(core.drain_pending_pairs().unwrap(), vec![0, 0]);
    }

    #[test]
    fn disposal_removes_pending_computation_work() {
        let mut core = WasmCore::new_internal().unwrap();
        let signal = number_signal(&mut core, 0.0);
        let computation = core.create_computation_internal().unwrap();
        core.subscribe_internal(&signal, &computation).unwrap();
        core.set_scalar(&signal, ScalarValue::Number(1.0)).unwrap();
        core.dispose_computation_internal(&computation).unwrap();
        assert!(core.drain_pending_pairs().unwrap().is_empty());
    }

    #[test]
    fn dependency_replacement_validates_before_mutation() {
        let mut core = WasmCore::new_internal().unwrap();
        let first = number_signal(&mut core, 0.0);
        let second = number_signal(&mut core, 0.0);
        let computation = core.create_computation_internal().unwrap();
        core.replace_dependencies_internal(&computation, &[first])
            .unwrap();
        let mut other = WasmCore::new_internal().unwrap();
        let foreign = number_signal(&mut other, 0.0);
        assert_eq!(
            WasmCore::error_code(
                core.replace_dependencies_internal(&computation, &[second, foreign])
            ),
            Some("foreign_instance")
        );
        core.set_scalar(&first, ScalarValue::Number(1.0)).unwrap();
        assert_eq!(core.drain_pending_pairs().unwrap(), vec![0, 0]);
    }
}
