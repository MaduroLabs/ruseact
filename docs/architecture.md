# Ruseact architecture decisions

This document records the M0 foundation decisions. It describes boundaries and
constraints, not completed runtime behavior.

## Decision 1: RustReactiveCore is the reactive engine

`crates/ruseact-core` is the future home of platform-independent reactive graph
state: signal identities, subscriptions, dirty propagation, batching, and
mutation intents. It must not import browser APIs, `wasm-bindgen`, or DOM types.

The core does not contain a component tree, a virtual-DOM diff, or React Fiber.
Any scheduling behavior introduced after M0 must be specified with deterministic
Rust tests before it is connected to a host.

## Decision 2: WASM is an explicit bridge

`crates/ruseact-wasm` is a thin adapter between the core and JavaScript. It will
own the ABI, initialization, disposal, stale-handle behavior, and bounded batch
shapes. DOM objects and JavaScript callbacks remain owned by JavaScript. M0
creates the crate boundary but intentionally defines no ABI or
`wasm-bindgen` exports.

## Decision 3: TypeScript packages own the browser-facing surface

`packages/ruseact` is the public TypeScript/JSX and future compiler integration
boundary. `packages/ruseact-dom` is the future browser host adapter for DOM
operations and event lifecycle. M0 creates only package entry points; it does
not implement a compiler, renderer, hooks, or a scheduler.

The package boundaries do not claim React API compatibility. Any compatibility
surface requires an explicit semantic design and tests.

## Decision 4: Examples remain a separate repository

Consumer applications belong in the sibling `ruseact-examples` repository.
This repository contains no example applications and no sibling-path package
dependencies. Consumer checks will use published or explicitly pinned tarballs
once the packages have buildable output.

## Decision 5: Reproducible workspace tooling

- Rust is selected by `rust-toolchain.toml`, currently Rust `1.99.0` with
  `rustfmt`, `clippy`, and `wasm32-unknown-unknown`.
- Node is selected by `.nvmrc`, currently `24.22.3`.
- pnpm is pinned by the root `package.json` `packageManager` field to
  `12.16.1`; `pnpm-lock.yaml` is checked in and CI uses frozen installs.
- CI runs Rust and TypeScript checks on both Ubuntu and macOS. Skill structure
  validation runs as a separate required check.
