# M2.1 — WASM ABI design

**Status:** M2.1 design proposal approved for the M2.2 Rust bridge. M2.2
implements the approved Rust/WASM adapter contract; the public TypeScript
wrapper and runtime integration remain future work.

This document defines a candidate boundary between the TypeScript runtime, a
`crates/ruseact-wasm` adapter, and the platform-independent `ruseact-core`
graph. It separates facts verified in M1, the M2.1 recommendations that were
approved for M2.2, and the remaining future wrapper decisions.

## 1. Goals and non-goals

### Goals

- Preserve M1 graph identity, generation, dependency, dirty-queue, and batch
  invariants across a JavaScript/WASM boundary.
- Make ownership, disposal, stale-handle rejection, and error behavior
  explicit and testable.
- Keep ordinary signal and dependency operations synchronous after WASM
  initialization.
- Keep boundary payloads compact without exposing Rust pointers or relying on
  process-local identity as a browser-wide capability.
- Define a small bridge surface that can be tested independently from the
  compiler and DOM adapter.
- Establish a measurement plan before making crossing or serialization
  performance claims.

### Non-goals

M2.1 does not implement `wasm-bindgen` exports, JavaScript wrappers, signal
value conversion, computation execution, scheduling, callbacks, compiler
integration, DOM operations, React compatibility, or a binary wire protocol.
It also does not change the M1 RustReactiveCore APIs or equality semantics.

## 2. Verified M1 contract

The following facts were inspected in `crates/ruseact-core/src/lib.rs` at the
M2.1 baseline (`e4310e8a554a2cc28130bbd33862c11a19b08f2f`). They are the
contract that a bridge must adapt; they are not themselves a proposed JS API.

| Capability | Existing Rust contract | Boundary consequence |
| --- | --- | --- |
| Graph creation | `ReactiveGraph::try_new()` returns `GraphError`; `new()` panics only after graph-ID exhaustion. | The bridge must prefer a fallible creation result and never expose a Rust panic as an ordinary JS operation. |
| Graph identity | `GraphId` is a process-local non-zero `u64`; it is embedded in `NodeId` and `ComputationId`. | `GraphId` alone is not an instance-safe browser capability. The bridge needs an instance/owner check. |
| Signal creation | `create_signal<T>(T) -> Result<Signal<T>, SignalError>` stores a typed value in graph-owned `Box<dyn Any>`. | The bridge needs an explicit value tag and conversion policy; Rust generic handles cannot be passed directly to JS. |
| Signal access | `read<T>(Signal<T>) -> Result<&T, SignalError>` and `set<T>(Signal<T>, T) -> Result<SignalUpdate, SignalError>`. | Reads must copy or otherwise encode the value before returning across the boundary. Writes must preserve `PartialEq` behavior. |
| Signal identity | `Signal<T>` is a copyable, non-owning wrapper over `NodeId`; the graph owns storage. | A JS handle must not imply ownership or disposal by garbage collection. |
| Computation identity | `create_computation() -> Result<ComputationId, DependencyError>` creates metadata only; it does not execute a callback. | A computation handle identifies future dirty work, not a JS function or render callback. |
| Dependencies | `subscribe`, `unsubscribe`, and `replace_dependencies` validate graph and generation. Replacement validates all inputs before changing existing edges. | The adapter must preserve atomic failure and idempotent subscription behavior. |
| Dirty work | Changed writes mark subscribers and `drain_pending_computations()` returns a deterministic, deduplicated `Vec<ComputationId>`. | Drain is an identity transfer only. It must not execute JS or Rust computation bodies. |
| Batching | `begin_batch`/`end_batch` use checked nesting. Drain returns an empty vector without consuming work while depth is non-zero. | The bridge must preserve nested depth and the active-batch drain gate. |
| Disposal | Signal and computation disposal remove relationships and invalidate the current generation. | Use-after-dispose and stale generations must become stable bridge errors. There is currently no public `ReactiveGraph::dispose` method. |
| Core boundary | The crate forbids unsafe code and imports no browser or JS types. | Ownership and conversion belong in the bridge, not in `ruseact-core`. |

At the M2.1 baseline the `crates/ruseact-wasm` crate contained only package
metadata and an intentionally empty library. M2.2 now provides the first
Rust/WASM exports described in section 15. The `ruseact` and `ruseact-dom`
packages still contain placeholder entry points; no public TypeScript wrapper
is treated as implemented by this document.

## 3. Proposed boundary

The proposed layers are:

```text
TypeScript runtime
  -> public wrapper and value policy
  -> future ruseact-wasm adapter
  -> ReactiveGraph and explicit Rust value adapters
```

`ruseact-core` remains platform-independent. It must not import
`wasm-bindgen`, hold JavaScript objects, call callbacks, or know about DOM
ownership. The adapter may be compiled for WASM and may expose a narrower
operation set than the core. The TypeScript layer owns ergonomic handles,
generic type declarations, and browser-facing lifecycle policy.

The internal bridge surface should be narrower than the complete Rust API:

1. create and dispose one bridge-owned graph instance;
2. create, read, write, and dispose supported signal values;
3. create and dispose metadata-only computations;
4. add, remove, and atomically replace dependency edges;
5. begin/end batches;
6. drain pending computation identities;
7. return structured results and stable error codes.

No operation in this surface executes a computation, schedules a callback, or
mutates the DOM.

## 4. Handle representation

### Existing identity constraints

Each M1 `NodeId` and `ComputationId` contains a `GraphId`, a `u32` slot
index, and a `u32` generation. The graph ID prevents accidental use between
graphs in one process, while the generation rejects a handle after slot reuse.
These checks are necessary but insufficient for multiple WASM instances:
each instance can have its own process-local allocator and address space, so
the same numeric graph ID may be valid in two instances. Worker boundaries
also do not make a Rust handle transferable.

### Alternatives

| Model | Benefits | Costs and risks |
| --- | --- | --- |
| Packed numeric handle | Small payload and cheap comparisons. | A raw number hides kind, graph ownership, and generation; `u64`/`BigInt` support and accidental mixing need explicit policy. |
| Structured handle | Makes kind, graph/instance, slot, and generation visible and serializable; easy to inspect in tests. | More bytes and conversion work; callers could forge ordinary object fields unless the bridge validates every field. |
| Opaque JS wrapper | TypeScript branding and a private owner reference make accidental cross-instance use difficult; ergonomic disposal methods are possible. | Object allocation and wrapper lifetime cost; wrappers are not transferable to another worker and still require Rust-side validation. |

### Recommendation recorded by M2.1; approved for M2.2

Use opaque, branded TypeScript wrappers that retain a private reference to
their `CoreInstance`, backed by fixed-width Rust identity fields. The bridge
should validate:

1. the wrapper belongs to the active core instance;
2. the resource kind is correct (signal versus computation);
3. the graph token matches the graph owned by that instance;
4. the slot index is in range and the generation matches; and
5. the instance and graph are not disposed.

The internal wire form should carry a kind plus `graph token`, `slot index`,
and `generation` as fixed-width integers. The TypeScript wrapper can hide
these fields. A graph token/instance nonce must be distinct from the current
process-local `GraphId`; it may be assigned by the bridge instance and need
not be globally unique once the wrapper owner check is enforced.

For a same-instance pending drain, the internal representation should be a
copied `Uint32Array` of `(slot, generation)` pairs associated with the graph
that performed the call. If one bridge instance can own multiple graphs, the
response must also include a graph token or use triples. The public
TypeScript API should return validated `ComputationHandle` wrappers rather
than expose an unvalidated typed array.

Handles must not be interpreted as pointers, retained after disposal, or
transferred between workers/instances. A future explicit export/import or
value-copy protocol would be required for worker communication.

## 5. JavaScript/Rust value interoperability

The Rust core uses generic `T: PartialEq + 'static` values erased into
`Box<dyn Any>`. This does not mean that arbitrary JavaScript values can be
stored or compared by the core. The bridge needs an explicit tagged value
model and a per-signal type descriptor; TypeScript generics alone are erased
at runtime.

### Candidate MVP mapping — approved for the M2.2 bridge

| JavaScript input | Candidate bridge representation | Required policy |
| --- | --- | --- |
| `boolean` | Boolean tag and Rust `bool` | Exact boolean equality. |
| Finite `number` | `f64` tag and Rust `f64` | No separate integer type; reject `NaN`, infinities, and preserve Rust `PartialEq` including signed-zero equality. |
| `string` | UTF-8 copy and Rust `String` | Conversion allocates; invalid UTF-16/UTF-8 policy must be explicit in the binding. |
| `null` | Rejected in the M2.2 scalar adapter | Reserved for a future value contract; it is not stored in the core. |
| `undefined` | Rejected in the M2.2 scalar adapter | Reserved for a future value contract; it is not stored in the core. |
| arrays | Not in MVP, or an explicitly copied/serialized value type | No implicit `Box<dyn Any>` conversion. Element types, cycles, and mutation ownership need a separate contract. |
| objects | Not in MVP, or an opaque bridge-owned reference with explicit lifetime | Do not retain arbitrary JS objects in the core. Cycles, identity, mutation, and GC interaction are unresolved. |

The approved M2.2 set is booleans, finite `f64` values, and strings. There is
no separate integer representation, and `null`, `undefined`, arrays, and
objects are rejected until a concrete ownership and serialization contract is
approved for a later milestone.

`NaN` and infinities are rejected before they reach the core. For accepted
numbers, Rust `PartialEq` remains authoritative: `+0.0` and `-0.0` compare
equal, and the bridge does not normalize values to match a JavaScript
comparison operator.

## 6. Ownership and lifecycle

### Recommended model — approved for M2.2

- The Rust bridge owns one `ReactiveGraph` per `CoreInstance`.
- TypeScript objects are non-owning handles and do not dispose resources when
  they become unreachable.
- `createReactiveCore()` returns an active instance after WASM initialization.
- `dispose()` explicitly marks the instance disposed, invalidates all wrapper
  operations, and drops or releases its Rust graph.
- Signal and computation disposal are explicit. A second disposal returns the
  stable `stale_handle` result rather than panicking.
- Slot reuse increments the generation in the existing core; stale wrappers
  therefore remain invalid even if their slot is reused.
- Graph disposal invalidates every signal and computation wrapper owned by the
  graph. A wrapper from another instance is rejected before any graph lookup.

The current core has explicit node and computation disposal but no public
graph-dispose method. M2.2 must either define a bridge-owned drop boundary or
obtain approval for a minimal explicit core lifetime API. It must not pretend
that dropping a JavaScript wrapper disposes the graph.

`FinalizationRegistry` is not required for the MVP and must not be the source
of correctness. It could later be used only for diagnostics or best-effort
leak reporting after explicit disposal semantics are stable.

## 7. Error mapping

Expected operational errors cross the boundary as structured data rather than
an unstructured panic. The internal bridge uses a Rust `Result<T, JsValue>`;
wasm-bindgen turns an `Err` into a JavaScript exception whose thrown value is
the structured error object below. This keeps the generated ABI conventional
while preserving stable, inspectable error codes.

```ts
type CoreError = {
  code:
    | "graph_id_exhausted"
    | "node_id_exhausted"
    | "computation_id_exhausted"
    | "invalid_graph"
    | "invalid_signal"
    | "invalid_computation"
    | "type_mismatch"
    | "unsupported_value"
    | "batch_not_active"
    | "batch_depth_overflow"
    | "disposed_instance"
    | "invalid_argument"
    | "internal_invariant";
  resource?: "graph" | "signal" | "computation";
  operation?: string;
  index?: number;
  generation?: number;
};

type CoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CoreError };
```

The error codes and fields below are the M2.2 bridge contract. The TypeScript
wrapper may later decode the thrown object into a result helper.
`GraphError::IdExhausted`,
`SignalError::{InvalidNode, TypeMismatch, NodeIdExhausted}`,
`DependencyError::{InvalidSignal, InvalidComputation,
ComputationIdExhausted}`, and `BatchError::{NotActive, DepthOverflow}` must
map deterministically without exposing Rust debug strings as the API. Handle
details may be included for diagnostics, but raw pointers and memory
addresses must never be returned.

Expected stale, foreign, disposed, type, and batch errors are ordinary
structured failures. An unexpected internal invariant violation is distinct:
the bridge reports a dedicated error and fails closed. The adapter must never
convert an invalid handle into a lookup of a caller-supplied slot.

## 8. Boundary communication and pending work

The first bridge should use synchronous calls for graph, signal, dependency,
batch, and drain operations after one asynchronous or otherwise explicit WASM
initialization step. Making each signal operation asynchronous would add
promise scheduling to a graph contract that is currently synchronous and
deterministic.

Individual calls are easiest to reason about and are appropriate for lifecycle
operations. Later profiling may justify a carefully scoped batch operation,
but M2.1 does not add a `setMany` protocol or a custom binary format. Any
batching at the boundary must preserve the core's explicit `begin_batch` /
`end_batch` semantics and must not be confused with computation scheduling.

For `drain_pending_computations()`:

1. Rust drains only after the outermost batch, using the existing FIFO and
   deduplication rules.
2. The bridge copies the returned identities into a JS-owned typed array or
   constructs validated wrappers from it.
3. The transfer contains identity fields only; it does not transfer Rust
   references or execute work.
4. The JS side treats the result as a snapshot. A later signal update may
   enqueue the same computation again after the core has cleared its dirty
   flag.
5. The M2.2 bridge copies the complete core result into a temporary Rust
   vector before constructing the JS-owned typed array. The bridge does not
   expose a recoverable per-item conversion path; an impossible registry
   mismatch is treated as `internal_invariant` and fails closed.

Typed arrays reduce object allocation for large queues, but a public raw array
would make forging handles easier. The recommended split is a compact typed
array internally and validated opaque computation handles in the public
TypeScript layer. This remains a design hypothesis, not a measured performance
result.

## 9. Candidate TypeScript API

The following is an illustrative contract, not an implemented or approved
API. `SignalHandle<T>` and `ComputationHandle` are opaque branded values.

```ts
type SignalHandle<T> = { readonly __brand: "RuseactSignal"; readonly __type?: T };
type ComputationHandle = { readonly __brand: "RuseactComputation" };

interface ReactiveCore {
  createSignal<T>(initial: SupportedValue<T>): CoreResult<SignalHandle<T>>;
  get<T>(signal: SignalHandle<T>): CoreResult<T>;
  set<T>(signal: SignalHandle<T>, value: SupportedValue<T>): CoreResult<SignalUpdate>;
  dispose(signal: SignalHandle<unknown> | ComputationHandle): CoreResult<void>;

  createComputation(): CoreResult<ComputationHandle>;
  subscribe<T>(signal: SignalHandle<T>, computation: ComputationHandle): CoreResult<boolean>;
  unsubscribe<T>(signal: SignalHandle<T>, computation: ComputationHandle): CoreResult<boolean>;
  replaceDependencies(
    computation: ComputationHandle,
    dependencies: readonly SignalHandle<unknown>[],
  ): CoreResult<void>;

  beginBatch(): CoreResult<void>;
  endBatch(): CoreResult<void>;
  drainPendingComputations(): CoreResult<readonly ComputationHandle[]>;
  dispose(): CoreResult<void>;
}

declare function createReactiveCore(options?: CoreOptions): Promise<CoreResult<ReactiveCore>>;
```

The overloaded `dispose` name is shown for readability; the final API should
avoid ambiguity between resource and graph disposal. `SupportedValue<T>` must
be a closed type matching the approved runtime value tags, not a promise that
all JavaScript objects are accepted.

Conceptual usage:

```ts
const coreResult = await createReactiveCore();
if (!coreResult.ok) throw new Error(coreResult.error.code);
const core = coreResult.value;

const count = core.createSignal(0);
const computation = core.createComputation();
if (!count.ok || !computation.ok) throw new Error("initialization failed");

core.subscribe(count.value, computation.value);
core.beginBatch();
core.set(count.value, 1);
core.set(count.value, 2); // one pending identity, final value is 2
const duringBatch = core.drainPendingComputations(); // empty, work retained
core.endBatch();
const pending = core.drainPendingComputations(); // computation.value once

core.dispose(computation.value);
core.dispose(count.value);
core.dispose();
```

The final bridge exports may use different names and may return flattened
numeric results for crossing efficiency. They must remain an internal detail
behind the TypeScript contract and must not expose `Box<dyn Any>`, Rust
references, or callback pointers.

## 10. Validation plan for M2.2–M2.4

### Rust unit tests

Keep M1 invariant tests in `ruseact-core` and add only bridge-independent
tests for any approved adapter value/error helpers. Test graph isolation,
generations, equality, dependency replacement atomicity, dirty ordering,
batch nesting, disposal, and pending-drain behavior without JavaScript.

### WASM integration tests

Run against the real generated WASM module and adapter. Cover initialization,
one instance and multiple instances, graph/handle isolation, stale
generations, typed value round trips, number/NaN policy, type mismatch,
structured errors, signal/computation disposal, double disposal, dependency
operations, dirty propagation, nested batching, pending-ID transfer, and
repeated init/dispose. These tests are required to detect ABI and linear
memory behavior that native Rust tests cannot observe.

### TypeScript integration tests

Test the public wrapper's branding and owner checks, result decoding, wrapper
disposal, cross-instance misuse, repeated initialization/disposal, and the
complete signal-to-pending-computation flow. Use a real WASM runtime for
integration tests; mocks may supplement unit tests but cannot establish that
the generated exports or memory transfer work.

M2.1 intentionally adds none of these integration tests because there is no
implemented ABI to exercise.

## 11. M2.5 performance measurement plan

Measure in a pinned environment, with warmup and repeated trials, while
recording browser/runtime, WASM build mode, graph size, signal count,
computation count, dependency-edge count, and affected-computation count.
Use representative small, medium, and large fixtures and an independent
correctness check around each workload.

Metrics:

- WASM initialization and graph creation time;
- JavaScript-to-WASM call overhead for empty/control operations;
- signal create, read, changed-write, and unchanged-write latency;
- handle validation cost for live, stale, and foreign handles;
- value conversion and string/collection copy cost;
- allocation and disposal cost;
- dirty propagation and pending-queue drain latency;
- nested-batch update and pending-ID transfer efficiency; and
- memory retained per graph, signal, computation, and dependency edge.

Report total operations, elapsed time, throughput where meaningful, and
percentiles only when the sampling method supports them. Separate Rust-native
core time from JS/WASM crossing, conversion, and wrapper allocation time.
Do not compare these measurements with React or another framework until a
separate, equivalent browser workload exists. Do not infer DOM, rendering, or
application performance from this plan.

## 12. Risks and trade-offs

- A compact numeric ABI is efficient but makes forged or cross-instance values
  easier to construct; wrapper ownership and Rust validation are both needed.
- Structured handles are easier to debug but increase transfer size and can be
  mistaken for trusted objects unless every field is checked.
- Opaque wrappers improve local ergonomics but cannot be transferred between
  workers and may allocate heavily in large pending queues.
- Copying values and pending IDs is predictable but adds allocation and
  conversion costs. Borrowed Rust references cannot safely outlive a boundary
  call.
- Supporting arbitrary objects would couple core storage to JS/GC semantics;
  deferring them keeps the M1 core independent but limits the first API.
- Structured thrown error objects make expected invalid-handle and lifecycle
  failures inspectable while retaining the conventional wasm-bindgen `Result`
  ABI.
- A bridge-owned graph lifetime is deterministic, but the missing public core
  graph-disposal API must be resolved before resource reclamation is claimed.

## 13. M2.1 open decisions (resolved for M2.2)

These were the decisions presented for approval at the end of M2.1. The user
approved the following MVP choices before M2.2 implementation:

1. whether graph disposal is bridge-owned only or needs a minimal core API;
2. the exact internal handle layout and whether any `u64` is exposed as
   `BigInt`, split integers, or opaque wrapper state;
3. the future value tags beyond the approved boolean, finite-`f64`, and string
   set;
4. structured results versus exceptions for expected and invariant errors;
5. the typed-array layout for pending computation IDs;
6. whether `FinalizationRegistry` is permitted for diagnostics only;
7. the WASM binding technology and package/bundler initialization contract;
8. whether worker transfer is unsupported in M2 or receives an explicit
   copy/import protocol; and
9. the test/runtime matrix and benchmark environment for later milestones.

The public TypeScript wrapper and worker-transfer policy remain future
decisions even though the Rust bridge choices are implemented below.

## 14. M2.2 implementation boundary

M2.2 adds the smallest bridge necessary to create and own a graph, adapt the
approved scalar value set, validate handles, map errors, expose
dependency/batch/drain operations, and run real WASM smoke tests. It preserves
M1 APIs and invariants and keeps computation execution, scheduling, compiler
behavior, and DOM work out of scope.

Any change to `ruseact-core` beyond an approved lifetime or adapter contract
is a new architecture decision. The implementation details and remaining
handoff boundaries are recorded below.

## 15. M2.2 approved implementation

The following is verified implementation, not a future proposal.

- `wasm-bindgen` `0.2.130` provides ES-module-compatible exports and
  `js-sys` `0.3.107` provides `Uint32Array` and structured error objects.
- `WasmCore` owns one `ReactiveGraph`; explicit `dispose()` drops it and
  invalidates the bridge registries. Double disposal and post-disposal use
  return `disposed_instance`.
- `WasmHandle` is an opaque class with private instance token, graph ID,
  resource kind, slot, and generation fields. Every operation validates these
  fields and the corresponding live core identity. A `WasmDependencyList` is
  likewise bound to its creating core and graph.
- The only accepted values are boolean, finite `f64`, and UTF-8 string.
  `NaN`, infinities, `null`, `undefined`, arrays, objects, functions, and
  symbols return `unsupported_value`; a value of the wrong signal type returns
  `type_mismatch`. Rust `PartialEq` remains authoritative, including equal
  positive and negative zero.
- Operational failures use stable error codes. Rust `Result<T, JsValue>` is
  exposed by wasm-bindgen as a thrown plain object with `code`, `operation`,
  and optional resource identity fields. No raw pointer, address, or Rust
  debug string is part of the contract.
- `drain_pending_computations()` copies FIFO `(slot, generation)` pairs into a
  `Uint32Array`. It honors the active-batch gate and performs no computation
  execution. The bridge registry is checked before identities are encoded;
  an impossible mismatch is an internal invariant failure rather than a
  silently dropped pending item.

The reproducible bridge verification sequence is:

```bash
cargo build -p ruseact-wasm --target wasm32-unknown-unknown --release --locked
wasm-bindgen target/wasm32-unknown-unknown/release/ruseact_wasm.wasm \
  --target nodejs --out-dir /tmp/ruseact-m2.2-bindgen
RUSEACT_WASM_BINDGEN_OUT=/tmp/ruseact-m2.2-bindgen \
  node scripts/test_wasm_bridge.mjs
```

The committed smoke test exercises actual generated Node/WASM bindings for
scalar round trips, equality-aware writes, dependency operations, nested
batching, FIFO pending transfer, cross-instance misuse, stale handles, and
explicit disposal. M2.3 owns the ergonomic TypeScript wrapper and its broader
integration matrix; M2.2 does not claim browser, worker, DOM, or application
performance.
