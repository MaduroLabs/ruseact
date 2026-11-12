---
name: ruseact-benchmark
description: Benchmark and profile Ruseact against React, React Compiler, Solid, or other alternatives, including Rust/WASM crossing overhead, DOM commit, memory, startup, and p95 update latency.
---
# Evidence-based performance testing

## Procedure
1. Define the workload, baseline, device/browser, sample count and success metric before implementation changes.
2. Compare **equivalent observable UI behavior**; do not conflate build-time compilation with runtime work. Test cold start, steady-state, p50/p95 and memory where relevant.
3. Separate compiler time, JS component time, Rust graph propagation, JS↔WASM calls and DOM commit time.
4. Run multiple warmed-up trials and record raw results, benchmark source SHA, Node/Rust/browser versions, CPU/OS, WASM build flags and statistical summaries.
5. Keep baseline apps in a separate benchmark location and consumer examples in the separate repo; do not edit baseline behavior to make Ruseact look better.
6. Report regressions as well as wins; if unmeasured, state 'hypothesis' rather than 'faster'.

## Acceptance
A performance claim needs reproducible code, command, environment, metrics, and evidence. Prefer existing established benchmark suites when compatible; no invented numbers.
