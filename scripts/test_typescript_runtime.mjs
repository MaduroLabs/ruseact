import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindgenDirectory = process.env.RUSEACT_WASM_BINDGEN_OUT;
if (bindgenDirectory === undefined) {
  throw new Error("RUSEACT_WASM_BINDGEN_OUT must point to generated Node/WASM bindings");
}

const wasmModulePath = path.join(path.resolve(bindgenDirectory), "ruseact_wasm.js");
readFileSync(wasmModulePath);

function ok(result) {
  assert.equal(result.ok, true, `expected success, received ${JSON.stringify(result)}`);
  return result.value;
}

function error(result, code, kind = "operational") {
  assert.equal(result.ok, false, "expected a CoreResult failure");
  assert.equal(result.error.code, code);
  assert.equal(result.error.kind, kind);
  return result.error;
}

function compileRuntime(outputDirectory) {
  execFileSync(
    "corepack",
    [
      "pnpm",
      "exec",
      "tsc",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--strict",
      "--skipLibCheck",
      "--declaration",
      "false",
      "--noEmit",
      "false",
      "--outDir",
      outputDirectory,
      "packages/ruseact/src/index.ts",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  writeFileSync(path.join(outputDirectory, "package.json"), '{"type":"module"}\n');
}

const compiledRuntimeDirectory = mkdtempSync(path.join(tmpdir(), "ruseact-runtime-"));
try {
  compileRuntime(compiledRuntimeDirectory);
  const runtime = await import(
    pathToFileURL(path.join(compiledRuntimeDirectory, "index.js")).href,
  );
  const wasmModule = await import(pathToFileURL(wasmModulePath).href);

  const initializationFailure = await runtime.createReactiveCore(async () => {
    throw new Error("loader failure is normalized");
  });
  error(initializationFailure, "initialization_failed", "internal");

  const firstResult = await runtime.createReactiveCore(async () => wasmModule);
  const first = ok(firstResult);
  const second = ok(await runtime.createReactiveCore(async () => wasmModule));

  const booleanSignal = ok(first.createSignal(true));
  const numberSignal = ok(first.createSignal(0));
  const stringSignal = ok(first.createSignal("ready"));
  assert.equal(ok(first.get(booleanSignal)), true);
  assert.equal(ok(first.get(numberSignal)), 0);
  assert.equal(ok(first.get(stringSignal)), "ready");
  assert.equal(ok(first.set(numberSignal, -0)), "unchanged");
  assert.equal(ok(first.set(numberSignal, 1)), "changed");
  assert.equal(ok(first.get(numberSignal)), 1);
  error(first.createSignal(NaN), "unsupported_value");
  error(first.createSignal(Infinity), "unsupported_value");
  error(first.createSignal(null), "unsupported_value");
  error(first.set(booleanSignal, "wrong"), "type_mismatch");

  const firstComputation = ok(first.createComputation());
  const secondComputation = ok(first.createComputation());
  const secondSignal = ok(second.createSignal(0));
  assert.equal(ok(first.subscribe(numberSignal, firstComputation)), true);
  assert.equal(ok(first.subscribe(numberSignal, firstComputation)), false);
  assert.equal(ok(first.subscribe(numberSignal, secondComputation)), true);
  assert.equal(ok(first.subscribe(numberSignal, secondComputation)), false);
  ok(first.replaceDependencies(firstComputation, [numberSignal, stringSignal, numberSignal]));
  assert.equal(ok(first.unsubscribe(numberSignal, secondComputation)), true);
  assert.equal(ok(first.unsubscribe(numberSignal, secondComputation)), false);
  error(
    first.replaceDependencies(firstComputation, [numberSignal, secondSignal]),
    "foreign_instance",
  );
  ok(first.set(stringSignal, "updated"));
  assert.deepEqual(ok(first.drainPendingComputations()), [firstComputation]);

  ok(first.beginBatch());
  ok(first.set(numberSignal, 2));
  assert.deepEqual(ok(first.drainPendingComputations()), []);
  ok(first.beginBatch());
  ok(first.set(numberSignal, 3));
  assert.deepEqual(ok(first.drainPendingComputations()), []);
  ok(first.endBatch());
  assert.deepEqual(ok(first.drainPendingComputations()), []);
  ok(first.endBatch());
  assert.deepEqual(ok(first.drainPendingComputations()), [firstComputation]);

  assert.equal(ok(first.subscribe(numberSignal, secondComputation)), true);
  ok(first.set(numberSignal, 4));
  ok(first.set(numberSignal, 5));
  assert.deepEqual(ok(first.drainPendingComputations()), [firstComputation, secondComputation]);
  assert.deepEqual(ok(first.drainPendingComputations()), []);

  error(second.get(numberSignal), "foreign_instance");
  ok(first.disposeComputation(secondComputation));
  error(first.disposeComputation(secondComputation), "stale_handle");
  const replacementComputation = ok(first.createComputation());
  assert.equal(ok(first.subscribe(numberSignal, replacementComputation)), true);
  ok(first.set(numberSignal, 6));
  assert.deepEqual(ok(first.drainPendingComputations()), [firstComputation, replacementComputation]);

  ok(first.disposeSignal(stringSignal));
  error(first.get(stringSignal), "stale_handle");
  error(first.disposeSignal(stringSignal), "stale_handle");

  ok(first.dispose());
  error(first.get(numberSignal), "disposed_instance");
  error(first.createComputation(), "disposed_instance");
  error(first.dispose(), "disposed_instance");
  ok(second.dispose());

  class CorruptCore extends wasmModule.WasmCore {
    drain_pending_computations() {
      const pending = super.drain_pending_computations();
      return new Uint32Array([...pending, 0, 0xffffffff]);
    }
  }

  const corrupt = ok(await runtime.createReactiveCore(async () => ({ WasmCore: CorruptCore })));
  const corruptSignal = ok(corrupt.createSignal(0));
  const corruptComputation = ok(corrupt.createComputation());
  ok(corrupt.subscribe(corruptSignal, corruptComputation));
  ok(corrupt.set(corruptSignal, 1));
  error(corrupt.drainPendingComputations(), "internal_invariant", "internal");
  ok(corrupt.dispose());

  console.log("M2.3 TypeScript runtime real-WASM integration test passed");
} finally {
  rmSync(compiledRuntimeDirectory, { recursive: true, force: true });
}
