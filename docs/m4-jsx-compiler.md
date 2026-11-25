# M4.3 JSX/TSX compiler MVP

Status: M4.3 is complete and M4.4.2 extends this private compiler with the
approved static component-placement subset. This document describes the
implemented boundary; it does not add a public compiler package or promise
React JSX compatibility.

## Purpose and boundary

The compiler is an internal TypeScript Compiler API transform from a narrow
TSX subset to executable JavaScript modules that produce the implemented M4.2
`ViewDescription` version 1 and approved version 2 component-placement
contracts. It reuses `ruseact-dom`'s public
renderer and does not add a second renderer, a virtual DOM, a scheduler, a
component runtime, or a new Rust/WASM interface.

The compiler owns syntax analysis, static-plan generation, stable local IDs,
and source diagnostics. JavaScript remains responsible for closures, event
handlers, signal-handle values, and expression execution. RustReactiveCore
continues to own signal storage and invalidation only.

## Compiler pipeline

`compileTsxModule(source, options)` performs these bounded steps:

1. Parse the source with the repository-pinned TypeScript Compiler API in TSX
   mode.
2. Convert parser diagnostics to filename, line, column, category, and code.
3. Walk JSX AST nodes, rejecting unsupported syntax before emitting a plan.
4. Lower lowercase HTML intrinsic elements and static text into M4.2 static
   node plans.
5. Lower explicit binding markers into M4.2 binding slots and preserve the
   original JavaScript evaluator and listener closures.
6. Emit an ESM module with TypeScript's printer/transpiler. No `eval`,
   `Function`, string-to-code runtime evaluation, or JSX runtime is used.

The internal module is `packages/ruseact-compiler/src/index.ts`. It is private
and is not re-exported from `ruseact` or `ruseact-dom`.

## Supported JSX subset

- Lowercase HTML intrinsic elements, including nested elements and custom
  element names that satisfy the existing HTML name boundary.
- Static text, static string attributes, multiple static children, and stable
  child order.
- `value`, `checked`, and `disabled` when their scalar types match the M4.2
  property contract.
- Native event attributes such as `onClick` and `onClickCapture` with
  JavaScript handler expressions. Handlers remain ordinary closures and do not
  trigger an implicit flush.
- Explicit compiler-only binding markers:

  ```tsx
  <span>{ruseact.bindText([count], ({ runtime }) => runtime.get(count))}</span>
  <input disabled={ruseact.bindProperty(
    [disabled],
    ({ runtime }) => runtime.get(disabled),
  )} />
  <div title={ruseact.bindAttribute(
    [label],
    ({ runtime }) => runtime.get(label),
  )} />
  ```

The marker is provisional compiler input, not a public runtime function. Its
dependency array must contain explicit signal references, and its evaluator
must return a structured `CoreResult` from the supplied runtime or an
equivalent structured result. Text and attribute slots normalize successful
scalar results to strings; property slots preserve the existing boolean/string
contract. The compiler never constructs or serializes a signal or computation
handle.

M4.4.2 also accepts statically named uppercase component references such as
`<Heading label="Title" />` and emits version-2 placement metadata. The
component reference remains a lexical JavaScript value supplied by the caller;
the compiler does not invoke or serialize it. The caller supplies a validated
`defineComponent` definition. Component props are scalar expressions or
explicit signal-handle references, and component children are not supported.

## Unsupported syntax

The compiler rejects, with source-located diagnostics:

- Dynamic component tags, component children, and unsupported uppercase forms.
- JSX fragments and structural conditional expressions.
- Dynamic JSX arrays, keyed lists, and children that produce multiple runtime
  nodes.
- JSX spread attributes and namespaced/unsupported namespaces such as SVG.
- Dynamic attributes or properties without an explicit binding marker.
- Unsupported property names when used as dynamic values.
- Implicit signal inference, automatic dependency tracking, hooks, and React
  APIs.

Rejecting these forms is intentional. A stale or structurally incorrect plan
is worse than a compile-time diagnostic. Conditional regions, keyed identity,
and dynamic tracking require separately approved contracts. Component setup and
nested ownership are implemented only at the M4.4.2 one-shot static-placement
scope.

## Generated module contract

Intrinsic-only generated code contains ordinary JavaScript closures and objects matching:

```ts
{
  protocol: "ruseact.template",
  version: 1,
  templateId: "m4.3-<stable-hash>",
  instantiate: () => ({
    nodes: [...],
    bindings: [...],
    listeners: [...],
  }),
}
```

When the plan contains statically named component references, the same
`ruseact.template` protocol uses version 2 and adds a `components` array of
`{ kind: "component", id, parentId, order, component, props }` placements.
Version 1 output remains unchanged for intrinsic-only modules.

Node IDs (`n0`, `n1`, ...), binding IDs (`b0`, `b1`, ...), listener IDs
(`l0`, `l1`, ...), and the template hash are deterministic for the source
fragment and filename. They are local plan identifiers, not DOM identity
registries or component identities. Generated evaluators execute when the
renderer performs initial registration or a later explicit `root.flush()`;
they do not capture a signal value at compile time.

Source metadata returned by the compiler records the source location of each
generated node and slot. M4.2's public plan protocol does not yet carry source
locations, so runtime renderer errors remain the existing structured renderer
errors. Richer runtime source diagnostics are deferred.

## Verification

Unit and snapshot-style checks run with:

```bash
pnpm test:compiler
```

They cover static structure, whitespace, attributes/properties, deterministic
IDs, explicit dependencies, closures, evaluator behavior, diagnostics, and
unsupported constructs. The real browser fixture runs with:

```bash
RUSEACT_BROWSER_BINDGEN_OUT=target/m4.3-browser-bindgen \
  pnpm test:browser:compiler
```

The hosted Chromium job is authoritative. The fixture compiles Hello World and
an interactive counter, mounts them through public `createRoot`, verifies
manual flush boundaries and stable node identity, then verifies listener and
binding cleanup with the real Rust/WASM runtime.

## Future handoff

M4.4 may consider components and anchored structural regions. It must not infer
those semantics from this static compiler, and it must preserve the M4.2
one-shot root, dedicated-runtime, explicit-flush, and structured-result
contracts until a new approval changes them.
