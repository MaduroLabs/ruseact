# Ruseact

**An experimental React-inspired runtime powered by Rust.**

Ruseact explores alternative approaches to building a reactive frontend
framework, with a Rust-based reactive core and a TypeScript/JSX-facing API.

The goal is to investigate reactivity, scheduling, and rendering architectures
without relying on React Fiber.

> **Experimental / Early development**
>
> Ruseact is a research-oriented engineering project, not a production-ready
> framework or a drop-in replacement for React.

## Why Ruseact?

Modern frontend frameworks make different architectural trade-offs around
state management, scheduling, and rendering.

Ruseact explores a different separation of responsibilities:

- **Rust:** Reactive graph, signal identity, dependency management, and future
  scheduling.
- **TypeScript/JavaScript:** Component execution and browser-facing integration.
- **DOM adapter:** Native M3.2 host operations, M3.3 explicit bindings, the
  M3.4 root lifecycle, the approved M4.2 public renderer MVP, the narrow M4.3
  JSX/TSX compiler MVP, and the approved M4.4.2 one-shot component subset are
  implemented; conditional regions and keyed structural rendering remain
  deferred.

The project is an architectural experiment. No performance advantage or React
API compatibility is claimed.

## Development status

| Milestone                  | Status          |
| -------------------------- | --------------- |
| M0 — Workspace foundation  | Complete        |
| M1.1 — Signal foundation   | Complete        |
| M1.2 — Dependency tracking | Complete        |
| M1.3 — Dirty propagation | Complete        |
| M1.4 — Batching            | Complete        |
| M1.5 — Core verification and benchmark baseline | Complete |
| M2.1 — WASM ABI design | Reviewed and approved |
| M2.2 — Rust WASM exports | Complete |
| M2.2.1 — Computation identity bridge | Complete |
| M2.3 — TypeScript runtime bridge | Complete |
| M2.4 — Browser and WASM integration testing | Complete; hosted CI verification passed |
| M2.5 — WASM bridge performance benchmark | Complete; hosted measurement integrity passed |
| M3.1 — DOM renderer architecture design | Complete; public renderer decisions remain deferred |
| M3.2 — DOM host operations | Complete; hosted Chromium validation passed |
| M3.3 — Reactive DOM bindings | Internal explicit binding prototype complete; no public renderer API |
| M3.4 — Root mount and lifecycle | Internal root lifecycle prototype complete; no public renderer API |
| M3.5 — End-to-end DOM integration and benchmark | Complete; hosted Chromium correctness and benchmark integrity passed |
| M4.1 — Public renderer and compiler contract design | Complete; M4.2 subset approved |
| M4.2 — Public renderer MVP | Complete; hosted Chromium verification passed |
| M4.3 — JSX/TSX compiler MVP | Complete; hosted Chromium verification passed |
| M4.4.1 — Component and structural rendering contract | Complete; conditional and keyed contracts remain deferred |
| M4.4.2 — Function components and nested ownership | Implemented on the reviewed feature branch; hosted Chromium verification required |
| Scheduling and execution   | Not implemented |
| WASM integration           | M2.3 Node/WASM runtime and M2.4 hosted browser verification complete |
| DOM renderer               | M3.1 design, M3.2–M3.5 internal path, and M4.2 public static renderer complete |
| Compiler integration       | M4.3 intrinsic TSX and M4.4.2 static component placement transforms implemented; structural syntax deferred |
| Manual-approval development workflow | Implemented; CI and protected rulesets remain enabled |

### Currently implemented

The Rust reactive core supports:

- Typed signals with graph-owned storage.
- Graph-scoped generational identities.
- Change detection using `PartialEq`.
- Explicit computation registration.
- Bidirectional signal-computation dependencies.
- Subscription, unsubscription, and dependency replacement.
- Dependency cleanup on disposal.
- Validation of stale and foreign handles.
- Changed-signal dirty propagation with deterministic, deduplicated pending
  computation IDs.
- Explicit pending-work draining without computation execution.
- Explicit nested batching that keeps pending work gated until the outermost
  batch ends.
- Deterministic reference-model stress coverage for dependency, queue,
  lifecycle, batching, graph-isolation, and generational-identity invariants.
- A dependency-free Rust-native benchmark baseline for core graph operations;
  these measurements are not browser, JavaScript, WASM-bridge, or rendering
  benchmarks.
- A first `wasm-bindgen` bridge in `crates/ruseact-wasm` with explicit graph
  disposal, opaque validated signal and computation handles, scalar signal
  operations, dependency metadata operations, nested batching, and copied
  pending-computation IDs. The bridge does not execute computations.
- A validated `WasmCore.computation_identity()` export that returns the copied
  `(slot, generation)` metadata for an existing live computation handle. The
  accessor is instance-bound and read-only; it does not construct handles from
  caller-provided numeric identities.
- A TypeScript runtime in `packages/ruseact` with opaque instance-owned signal
  and computation handles, explicit disposal, scalar validation, dependency
  operations, nested batching, structured `CoreResult` errors, and safe
  pending-computation identity resolution.
- An internal `packages/ruseact-dom` host context for owned HTML element and
  text creation, deterministic insertion/removal, safe text and attribute
  updates, narrow `value`/`checked`/`disabled` property writes, native event
  listener lifecycle, ownership validation, and explicit cleanup. The host
  context is not exported from the package entry point.
- An internal M3.3 binding context in `packages/ruseact-dom/src/bindings.ts`
  that creates legitimate runtime computations, registers explicit signal
  dependencies, performs initial JavaScript-owned updates, resolves pending
  computation handles in FIFO order, and performs one explicit flush pass.
  It borrows the runtime, signals, and host context; it does not add a second
  reactive graph or dispose borrowed resources.
- An internal M3.4 root context in `packages/ruseact-dom/src/root.ts` that
  claims one container, coordinates one host and one binding context while
  mounted, provides an imperative construction scope, performs explicit
  mount/flush/unmount/dispose transitions, and rolls back renderer-owned
  nodes, listeners, subscriptions, and computations on mount failure.
- A test-only M2.5 benchmark harness that separates direct generated WASM
  calls, public TypeScript runtime calls, and real Chromium execution. It
  records deterministic 16/64/256-signal workloads, raw samples, summaries,
  correctness checks, and structured artifacts without changing runtime APIs.
- An M3.5 test-only end-to-end harness that drives the real Rust/WASM runtime
  through the internal root and binding contexts into native Chromium DOM
  mutations. Its benchmark workloads measure explicit mount, signal update,
  binding flush, and teardown phases separately; it does not add scheduling or
  a public renderer API.

- An M4.2 public `ruseact-dom` façade with `createRoot(container, runtime)`;
  typed `RendererRoot` lifecycle operations; immutable static mount plans;
  stable local node IDs; scalar text, supported attribute/property, and native
  listener slots; explicit signal dependencies; structured renderer results;
  one-shot mount semantics; and delegation to the existing M3.2–M3.4
  ownership, binding, and cleanup pipeline.

- An internal M4.3/M4.4.2 compiler module in `packages/ruseact-compiler` that parses
  a deliberately limited TSX subset with the TypeScript Compiler API and emits
  executable ESM compatible with `ViewDescription` versions 1 and 2. It
  generates deterministic static node, component, and slot IDs, preserves
  JavaScript closures and event handlers, requires explicit compiler-only
  dependency markers, and reports source-located diagnostics for unsupported
  syntax. Component setup is supplied separately through `defineComponent`;
  the compiler does not add a component rerender engine or structural
  reconciliation.

- An M4.4.1 design for component identity, hierarchical resource ownership,
  anchored conditional regions, keyed-only list identity, and their compiler
  and flush boundaries. M4.4.2 now implements only the approved one-shot
  component and nested-owner subset; structural regions, keyed lists, anchors,
  and component rerendering remain deferred.

M4.1 defined the renderer/compiler contract and the project owner approved the
narrow M4.2 subset. M4.2 implements the public root façade over the internal
lifecycle, static mount plans, explicit binding slots, structured results, and
manual flush. M4.3 emits the intrinsic version-1 plan with provisional
`ruseact.bindText`, `bindAttribute`, and `bindProperty` compiler markers, not
public runtime APIs. M4.4.2 adds only the approved static version-2 component
placements and hierarchical ownership; structural regions, automatic
dependency tracking, and scheduling remain deferred.

The M4.4.1 proposal in
[docs/m4.4-component-structural-design.md](docs/m4.4-component-structural-design.md)
keeps those capabilities deferred while defining alternatives and approval
gates for M4.4.2–M4.4.4. Its recommended hybrid uses one-shot component setup,
explicit owner scopes, anchored conditionals, and keyed-only lists. No part of
that proposal changes the implemented M4.2/M4.3 protocol.

Rust computation execution, automatic dependency tracking, and scheduling are
not implemented. M3.3 and M3.4 execute explicitly registered JavaScript
updates only. The public DOM renderer and private compiler are implemented only
at the narrow M4.2/M4.3 scope described above; a browser bundler matrix,
worker handle transfer, components, and structural rendering remain deferred.

M3.1 documents a proposed DOM renderer architecture in
[docs/dom-renderer-design.md](docs/dom-renderer-design.md). The proposal
recommends a hybrid design with compiler-assisted static templates and
fine-grained JavaScript-owned DOM bindings, plus an explicit fallback while
compiler work is pending. It does not add renderer code, computation
execution, automatic dependency tracking, scheduling, or a public DOM API.

## Repository structure

- `crates/ruseact-core` — Platform-independent Rust reactive core.
- `crates/ruseact-wasm` — Rust-to-JavaScript WASM bridge for the approved M2.2
  scalar and reactive-identity ABI.
- `packages/ruseact` — TypeScript runtime bridge and shared scalar/handle
  types.
- `packages/ruseact-compiler` — private TypeScript Compiler API transform for
  the supported M4.3 TSX subset; it is not a published package.
- `packages/ruseact-dom` — Browser host adapter, explicit bindings, internal
  root lifecycle, and the M4.2 public renderer façade.
- `docs` — Architecture decisions and technical documentation.

The [M2.1 WASM ABI design](docs/wasm-abi-design.md) records the reviewed
handle, value, ownership, error, and pending-work contract. M2.2 and M2.2.1
implement the Rust bridge; M2.3 adds the typed runtime wrapper without
duplicating the reactive engine.

Example applications are maintained in a separate repository.

The planned DOM renderer design and M3.2 implementation handoff are recorded
in [docs/dom-renderer-design.md](docs/dom-renderer-design.md). Example
applications, including a future Counter consumer, remain in the separate
`ruseact-examples` repository and are not added here.

## M3.2 internal DOM host operations

M3.2 establishes the internal browser mutation layer in
`packages/ruseact-dom/src/host.ts`. A host context explicitly claims a future
root container and owns nodes it creates. A module-private ownership registry
rejects foreign-context and foreign-document mutations, while disposal
removes only safe, owned nodes and releases listener records. Unrelated
container children are preserved.

The implemented host supports HTML element and text creation, deterministic
`insertBefore`/append/remove operations, escaped text updates, string
attributes, the narrow `value`/`checked`/`disabled` property set, and native
event listeners with duplicate detection and exact cleanup. The HTML namespace
is the only supported namespace; SVG is intentionally rejected. Invalid,
foreign, detached, and disposed resources produce internal `DomHostError`
values. Raw HTML, arbitrary property assignment, synthetic events, a virtual
DOM, and a public root lifecycle are not implemented. M3.4 consumes this host
only through its internal root coordinator.

The browser test command is `corepack pnpm test:browser:dom`. It uses the
existing hosted Chromium job; the InstaBox environment is not treated as an
authoritative local browser environment because it cannot reliably reach its
own temporary HTTP server. Reactive bindings and root lifecycle execution
remain internal functionality; no public root/flush lifecycle is exported.

## M3.3 internal reactive DOM bindings

M3.3 adds `createBindingContext(host, runtime)` in the internal
`packages/ruseact-dom/src/bindings.ts` module. The package entry point remains
empty, so this is not a public renderer API. A binding creates one legitimate
`ComputationHandle`, replaces its explicit signal dependencies atomically,
executes its JavaScript-owned update function once, and stores the binding by
the opaque computation handle.

`flush()` calls the existing runtime drain exactly once, resolves the returned
handles through the private binding map, and executes live bindings in
Rust-provided FIFO order. It does not schedule work, infer dependencies, drain
again, or execute Rust callbacks. Signal writes performed during an update stay
pending for a later explicit flush. Reentrant flushes are rejected.

One active binding context is permitted per dedicated `ReactiveCore` instance.
The context borrows the runtime, signals, host context, and DOM nodes; it owns
only its computations and subscriptions. Binding and context disposal removes
subscriptions and computations without disposing the borrowed runtime or
signals. Unknown pending computations fail closed because the existing runtime
drain is global and destructive; shared-runtime renderer support remains
deferred.

The browser command is `corepack pnpm test:browser:bindings`. It builds the
real release WASM bindings and runs explicit text, attribute, property,
ordering, batching, reentrancy, disposal, foreign-instance, detached-target,
and unknown-pending checks in hosted Chromium. No public root, component,
compiler, scheduler, or automatic tracking behavior is added.

## M3.4 internal root mount and lifecycle

M3.4 adds `createRootContext(container, runtime)` in the internal
`packages/ruseact-dom/src/root.ts` module. The module is not re-exported from
`packages/ruseact-dom/src/index.ts`; it is an imperative construction boundary,
not a finalized public `createRoot()` contract.

An active root privately claims one Element or DocumentFragment and borrows
the container and ReactiveCore. A root creates one HostContext and, while
mounted, one BindingContext. The mount scope delegates element/text creation,
insertion, attributes, narrow properties, event listeners, and explicit
binding registration to those existing contexts. It does not duplicate DOM
ownership or reactive graph state.

The lifecycle is explicit: `created` → `mounting` → `mounted` →
`unmounting` → `unmounted` → `disposed`. A mount failure disposes successful
binding registrations and host resources, removes only renderer-created
nodes, preserves unrelated container children, and releases the container
claim when cleanup succeeds. Cleanup failures enter a fail-closed
`cleanup_failed` state and retain the root claim rather than pretending that
all resources were released.

`flush()` delegates to the M3.3 one-pass binding flush and is valid only while
mounted. There is no automatic scheduling, recursive drain, component
execution, or dependency inference. Unmount disposes renderer computations
and subscriptions before host listener/node cleanup; borrowed signals and the
ReactiveCore remain live. Container reuse requires a new root after successful
cleanup. Multiple active binding roots must use separate ReactiveCore
instances because the existing pending queue is global and destructive.

The hosted browser command is `corepack pnpm test:browser:root`. It exercises
real WASM, host operations, binding updates, explicit flush, event cleanup,
rollback, detachment, duplicate containers, runtime isolation, unmount, and
container reuse. This section describes the internal M3.4 boundary; the
package entry point now additionally exposes the approved M4.2 façade, while
component, compiler, scheduler, and structural renderer behavior remain future
work.

## M3.5 end-to-end DOM integration and benchmark

M3.5 validates the complete internal path:

```text
signal write → RustReactiveCore dirty propagation → WASM bridge →
TypeScript computation resolution → explicit binding execution → native DOM mutation
```

The real-browser correctness command is:

```bash
corepack pnpm test:browser:e2e
```

It initializes the actual generated WASM module, mounts a small imperative
counter fixture, dispatches native events, verifies explicit `root.flush()`
behavior, and checks cleanup, ownership, runtime isolation, and container
reuse. Updates are intentionally manual: M3.5 does not add a scheduler,
automatic dependency tracking, or a public `createRoot()` API.

The separate browser benchmark uses bounded workload sizes of 1, 10, 100, and
1000 bindings:

```bash
corepack pnpm benchmark:browser:dom
corepack pnpm benchmark:dom:validate -- target/m3.5-results/dom-results.json
```

Mount, unchanged write, changed write plus flush, multi-write flush, binding
fan-out, independent bindings, attribute/property updates, and root cleanup
are reported as separate phases. A small native DOM implementation runs the
same host mutation shapes as a reference for DOM host work only. It does not
include RustReactiveCore, WASM, binding dispatch, or renderer lifecycle work,
so it is not a framework comparison. The harness uses warmups, bounded
adaptive calibration, positive finite samples, actual operation counts, and
strict machine-readable integrity checks. Hosted Chromium is authoritative;
the InstaBox localhost browser limitation means local browser execution is
not reported as a pass. Numeric results are published as CI artifacts and
summarized in [the M3.5 benchmark report](docs/benchmarks/m3.5-dom-e2e-baseline.md).

## M4.1 public renderer and compiler contract design

M4.1 is documentation-only. The candidate public API is a façade resembling
`createRoot(container, runtime)` with explicit `mount`, `flush`, `unmount`,
and `dispose` operations. This is not exported or executable yet. The
recommended view direction is a hybrid whose primary path is compiler-assisted
static DOM templates with stable text/attribute/property binding slots and a
narrow imperative fallback.

The proposed compiler boundary uses a versioned template IR with stable local
node and binding IDs, explicit operation kinds, dependency metadata, source
locations, and future structural anchors. It must preserve JavaScript lexical
scope and evaluation order and must never construct WASM handles, store DOM
objects in Rust, or infer that arbitrary identifiers are signals.

The architecture design compares public API, view, component, dependency,
structural, and scheduling alternatives and proposes M4.2–M4.5 implementation
boundaries. The M4.2 subset of the façade, static mount plan, explicit
dependency model, one-shot lifecycle, structured results, and manual flush was
subsequently approved and implemented. Compiler, component, keyed-list, and
automatic scheduling choices remain deferred. See
[docs/m4-public-renderer-compiler-design.md](docs/m4-public-renderer-compiler-design.md).

## M4.2 public renderer MVP

M4.2 exports the first public DOM façade from `ruseact-dom`:

```ts
const rootResult = createRoot(container, runtime);
if (rootResult.ok) {
  const root = rootResult.value;
  root.mount(view);
  root.flush();
  root.unmount();
  root.dispose();
}
```

The public view is a one-shot immutable mount plan with stable node IDs,
explicit parent references, static HTML elements/text, supported attributes and
properties, native listeners, and scalar binding slots. Binding evaluators
receive the borrowed `ReactiveCore`; dependencies are supplied explicitly and
updates occur only during an explicit `root.flush()`.

`RendererResult<T>` preserves the existing structured `CoreResult` shape with
typed diagnostics. The root borrows the supplied runtime and container, owns
only renderer-created resources, never clears unrelated container children, and
requires a dedicated runtime for each active mounted root because pending
draining remains global and destructive. Mount is one-shot: there is no
`update(view)`, automatic scheduling, structural reconciliation, JSX compiler,
component runtime, or React API compatibility claim.

The hosted browser command is `corepack pnpm test:browser:public`. InstaBox
cannot reliably route Chromium to its temporary loopback server, so hosted
GitHub Chromium remains authoritative for public renderer correctness.

## M4.3 JSX/TSX compiler MVP

The internal compiler command is `corepack pnpm test:compiler`. It parses TSX
with TypeScript 5.9.3, emits ESM containing the existing `ruseact.template`
version-1 `ViewDescription`, and never uses regex parsing, `eval`, or
`Function`. Static HTML structure, text, supported properties, native event
closures, and explicit binding slots are supported. Dynamic JSX values must use
the provisional compiler-only `ruseact.bindText`, `bindAttribute`, or
`bindProperty` marker with an explicit signal list; arbitrary identifiers are
not inferred to be reactive.

The hosted browser command is `corepack pnpm test:browser:compiler`. It builds
the real Rust/WASM bindings, executes generated modules in Chromium through
the public renderer, and verifies compiled Hello World, Counter, and static
component/nested-owner fixtures. Uppercase statically named component
references emit version-2 placement metadata; the application supplies
`defineComponent` definitions and explicit props. Dynamic component tags,
component children, fragments, conditional structure, lists, spreads,
unsupported namespaces, implicit dependencies, hooks, and React-specific
syntax remain rejected. See
[docs/m4-jsx-compiler.md](docs/m4-jsx-compiler.md) and
[docs/m4.4.2-function-components.md](docs/m4.4.2-function-components.md).
The M4.4.2 component implementation uses hierarchical ownership for nested
components and keeps cleanup within the existing renderer lifecycle.

## Development

Use the Rust toolchain pinned in `rust-toolchain.toml` and the Node.js version
specified in `.nvmrc`.

Run the project checks:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
python3 scripts/validate_skills.py
cargo bench -p ruseact-core --bench core_baseline --locked -- --nocapture
```

These commands verify the workspace and current Rust core; they are not a
consumer application quickstart.

## M2.4 browser and WASM integration

M2.4 adds a real Chromium harness for the existing TypeScript runtime. The
harness serves a temporary `wasm-bindgen --target web` module over HTTP, loads
it through `createReactiveCore(loadWasm)`, and checks scalar signals,
dependencies, batching, pending-computation identity mapping, instance
isolation, structured errors, and explicit disposal. It does not render DOM,
execute computations, or add scheduling behavior.

The reproducible local preparation is:

```bash
cargo build -p ruseact-wasm --target wasm32-unknown-unknown --release --locked
wasm-bindgen target/wasm32-unknown-unknown/release/ruseact_wasm.wasm \
  --target web --out-dir target/m2.4-browser-bindgen
RUSEACT_BROWSER_BINDGEN_OUT="$PWD/target/m2.4-browser-bindgen" \
  corepack pnpm test:browser
```

The browser job in `.github/workflows/agent-config-check.yml` repeats this
build on a GitHub-hosted `ubuntu-latest` runner using the pinned Node, pnpm,
Rust, and `wasm-bindgen` versions, then runs Chromium against the temporary
HTTP server. That hosted job is the authoritative browser verification
environment. The current InstaBox cannot route Chromium requests to a local
HTTP server, so an unsuccessful local browser launch is not reported as a
browser pass or a runtime failure. The repository currently claims only the
tested Chromium configuration; it does not claim broad cross-browser or
bundler compatibility.

The hosted verification run `44426020307` passed with Google Chrome
`157.0.8103.50` and 94 browser assertions. Repository administrators must add
the `Browser (chromium)` context to the protected-branch required-check lists
if browser verification is to gate merges; this PR does not modify rulesets.

After a successful browser CI run, the branch remains subject to normal manual
review and protected-branch workflow. M2.5 will define performance
measurements; M2.4 makes no rendering or WASM performance claims.

## M2.5 WASM bridge performance benchmark

M2.5 measures the existing runtime only. The benchmark covers scalar signal
operations, dependency metadata, dirty propagation, pending identity transfer,
explicit batching, initialization, and lifecycle work at 16, 64, and 256
signals. Direct WASM and public TypeScript rows remain separate because the
public layer performs handle validation, result normalization, and registry
work that direct calls do not. Browser runs use real Chromium with a DevTools
Protocol completion signal and real `performance.now()`; virtual-time and
`--dump-dom` completion are not used for performance measurements. Zero-median
or non-finite rows fail the benchmark integrity gate rather than being treated
as zero-cost operations. Short workloads first calibrate from their existing
operation counts against the measured browser timer resolution, using a
conservative minimum 2 ms target and bounded independent prepared states. If
an official trial still contains a zero or non-finite sample, the complete
warmup/trial attempt is discarded and retried with at least twice the batch
size, up to three attempts. Every attempt and resulting operation count is
recorded; the strict validator still rejects an unresolved final attempt. The
2 ms value is a calibration target, not an unconditional validity threshold:
when the batch ceiling is reached below that target, official samples may be
accepted only when they are finite and positive, their median clears the
timer-safety margin, and their central-50-percent interquartile range is no
more than four observed timer quanta plus a 1 ns rounding tolerance. This
quantization-aware dispersion gate applies to capped attempts; dispersion in a
target-reached attempt remains recorded as a diagnostic. The result records
whether a capped row was accepted as reliable or rejected as unresolved.

Run the manually reproducible Node benchmark after building matching bindings:

```bash
RUSEACT_WASM_BINDGEN_OUT="$PWD/target/m2.5-node-bindgen" \
corepack pnpm benchmark:node
```

Run the dependency-free deterministic calibration regression tests with:

```bash
corepack pnpm test:benchmark:calibration
```

The authoritative Node and real-Chromium run is the manually dispatched
`.github/workflows/m2.5-benchmark.yml`; it uploads JSON and Markdown results
and does not establish timing thresholds or a merge gate. See
[docs/benchmarks/m2.5-wasm-bridge-baseline.md](docs/benchmarks/m2.5-wasm-bridge-baseline.md)
for fixture accounting, methodology, results, limitations, and M3 handoff.

## M1.5 core verification and benchmark baseline

M1.5 verifies the M1.1–M1.4 RustReactiveCore contracts without adding runtime
features. The core tests cover signal and computation lifecycle cleanup,
bidirectional dependency consistency, atomic dependency replacement failures,
deterministic dirty ordering and deduplication, nested batch drain gating,
cross-graph isolation, stale-handle rejection, slot reuse, and generation
exhaustion. A bounded deterministic stress test runs 1,500 mixed operations
over 96 signals and 48 computations against an independent reference model;
the lifecycle churn test performs 256 allocation/disposal cycles.

Run the reproducible native baseline manually with:

```bash
cargo bench -p ruseact-core --bench core_baseline --locked -- --nocapture
```

The benchmark uses five warmed trials for small, medium, and large Rust graph
fixtures and reports median/p95 elapsed nanoseconds, nanoseconds per operation,
throughput, graph size, dependency edges, and affected computations. Results
and the measured environment are recorded in
[docs/benchmarks/m1.5-core-baseline.md](docs/benchmarks/m1.5-core-baseline.md).
They establish a reproducible Rust-native baseline only; they do not support
claims about React, Solid, Leptos, browser rendering, JavaScript execution,
WASM crossings, or end-to-end application performance.

## M2.2 Rust WASM bridge

The approved M2.2 bridge is implemented in `crates/ruseact-wasm` using
`wasm-bindgen` `0.2.130` and `js-sys` `0.3.107`. Each `WasmCore` owns one
RustReactiveCore graph and must be explicitly disposed. Handles are opaque
WASM objects; the bridge validates their instance, graph, resource kind, slot,
and generation before every operation. The bridge never exposes Rust pointers
or executes computation bodies.

The MVP accepts only booleans, finite `f64` numbers, and UTF-8 strings. Arrays,
objects, functions, symbols, `null`, `undefined`, `NaN`, and infinities are
rejected. Numeric equality follows Rust `f64` `PartialEq`, so `+0.0` and
`-0.0` are equal and an equal write does not create dirty work. Expected
operational failures are surfaced as generated JavaScript exceptions whose
value is a structured object containing a stable `code` and `operation` (and
resource identity fields where applicable).

Dependency lists are instance-bound and replace dependencies atomically. Batch
boundaries preserve M1.4 nested semantics. `drain_pending_computations()`
returns a copied `Uint32Array` containing FIFO `(slot, generation)` pairs;
`computation_identity()` returns the same pair format only after validating an
existing computation handle. The bridge does not transfer Rust references or
invoke JavaScript callbacks. Cross-worker handle transfer, automatic disposal,
computation execution, scheduling, and the public TypeScript wrapper remain
future work.

The identity accessor is the narrow M2.2.1 handoff for the future TypeScript
wrapper: on computation creation, the wrapper will retain the original opaque
handle in a per-instance registry keyed by the validated pair. Pending pairs
will be looked up in that registry after shape validation; they will never be
used to construct or forge a new `WasmHandle`. Unknown pairs are an internal
consistency failure, not an item to ignore or remap.

Build and run the bridge smoke test with a user-space `wasm-bindgen` CLI that
matches the crate version:

```bash
cargo build -p ruseact-wasm --target wasm32-unknown-unknown --release --locked
wasm-bindgen target/wasm32-unknown-unknown/release/ruseact_wasm.wasm \
  --target nodejs --out-dir /tmp/ruseact-m2.2-bindgen
RUSEACT_WASM_BINDGEN_OUT=/tmp/ruseact-m2.2-bindgen \
  node scripts/test_wasm_bridge.mjs
```

The generated bindings and WASM artifact are verification outputs and are not
committed. See [docs/wasm-abi-design.md](docs/wasm-abi-design.md) for the
boundary contract and [docs/work-progress.md](docs/work-progress.md) for the
verified command results and current M2.3 handoff.

## M2.3 TypeScript runtime bridge

`packages/ruseact` exposes `createReactiveCore(loadWasm)`, which asynchronously
loads a generated `wasm-bindgen` ES module and returns `Promise<CoreResult<ReactiveCore>>`.
The loader is explicit because generated WASM is not committed and browser
bundler initialization remains an M2.4 concern:

```ts
const result = await createReactiveCore(async () => import("./generated/ruseact_wasm.js"));
if (!result.ok) throw new Error(result.error.code);
const core = result.value;
```

After initialization, runtime operations are synchronous and return
`CoreResult<T>`. The public API includes `createSignal`, `get`, `set`,
`disposeSignal`, `createComputation`, `disposeComputation`, `subscribe`,
`unsubscribe`, `replaceDependencies`, `beginBatch`, `endBatch`,
`drainPendingComputations`, and `dispose`.

Only booleans, finite numbers, and strings are supported. `NaN`, infinities,
arrays, objects, functions, symbols, `null`, and `undefined` are rejected.
`set` reports `"changed"` or `"unchanged"`; Rust remains authoritative for
signal values and equality, including `+0.0 == -0.0`.

Signal and computation handles are opaque TypeScript objects backed by private
per-instance state. The runtime rejects forged, stale, disposed, and
cross-instance handles before calling the bridge. Computation creation calls
`computation_identity()` and stores the original WASM handle in a registry keyed
by the collision-free string `(slot:generation)`. Pending pairs are resolved
only to existing registered handles; unknown pairs return an internal failure
and are never constructed into WASM handles.

Dependency-list wrappers are temporary and explicitly freed after atomic
replacement. Runtime and resource disposal are explicit; no
`FinalizationRegistry` is used for correctness. Computations remain metadata
only: the runtime does not execute callbacks, schedule work, track dependencies
automatically, render DOM, or compile JSX.

Run the real Node/WASM runtime integration test with generated bindings:

```bash
cargo build -p ruseact-wasm --target wasm32-unknown-unknown --release --locked
wasm-bindgen target/wasm32-unknown-unknown/release/ruseact_wasm.wasm \
  --target nodejs --out-dir /tmp/ruseact-m2.3-bindgen
RUSEACT_WASM_BINDGEN_OUT=/tmp/ruseact-m2.3-bindgen \
  corepack pnpm test:runtime
```

This verifies the Node/WASM loading path and runtime behavior only. Browser
bundler compatibility and DOM integration are deferred to M2.4.

## Manual-approval development workflow

Ruseact uses a strictly manual, protected workflow for every development task:

```text
Task → feature branch from develop → implementation → README update →
validation → self-review → PR to develop → required CI → human squash merge →
explicit main-promotion request → verified promotion PR to main →
human squash merge → return to develop
```

Every new implementation task, milestone, and sub-milestone must update this
root README in the same branch and pull request. The CI documentation gate
rejects missing, empty, or whitespace-only updates; self-review must also
confirm that the changed documentation is relevant and factually consistent
with the implementation and tests.

The repository provides these workflow components:

- `Ruseact CI` runs Rust formatting, Clippy, workspace tests, WASM checks,
  TypeScript checks, skill validation, risk classification, and the README
  gate.
- The former `auto-merge-develop.yml` and `promote-main.yml` workflows are
  disabled in GitHub Actions and removed from the repository. They have no
  event-driven merge or promotion authority.

Use `$ruseact-pr-publish` to validate and publish a feature branch. It commits,
pushes the feature branch, opens a PR targeting `develop`, records the checked
SHA, and then stops. Codex must never merge that PR or enable auto-merge.

Use `$ruseact-main-promote` only after explicitly providing the merged PR
number and confirming that the task is complete. The skill verifies the exact
single-parent squash SHA, confirms it is the current `origin/develop` tip,
checks for duplicate promotion, creates a traceable promotion branch and PR to
`main`, validates it, and stops for the user's manual merge. It never selects
arbitrary `HEAD`, directly pushes `main`, or enables auto-merge.

CI and branch protection remain enabled. The active `develop` and `main`
rulesets require review, squash merging, and the configured `Ruseact CI`
contexts. Repository native auto-merge is disabled. Any future request to
re-enable merge or promotion automation requires a separate, explicitly
approved security and repository-settings change.

For a failure, preserve local and remote history and record the PR number,
source squash SHA, source and target branches, resulting main SHA if any,
failed operation, and whether a remote write completed. Resolve the cause,
rerun the exact manual verification, and never force-push, bypass protection,
or merge around a failed check.

## Architecture

See [Architecture Decisions](docs/architecture.md) for the design rationale,
ownership boundaries, reactive graph contracts, and implemented milestones.

## Contributing

Ruseact is in early development. Technical feedback, architecture discussions,
bug reports, and suggestions are welcome.

The public API and implementation may change substantially during development.

## License

MIT License.
