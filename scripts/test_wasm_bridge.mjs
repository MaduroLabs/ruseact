import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const outputDirectory = process.env.RUSEACT_WASM_BINDGEN_OUT ?? "/tmp/ruseact-m2.2-bindgen";
const modulePath = path.join(outputDirectory, "ruseact_wasm.js");
const { WasmCore } = await import(pathToFileURL(modulePath).href);

function expectError(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error?.code, code, `expected ${code}, received ${JSON.stringify(error)}`);
    return true;
  });
}

const first = new WasmCore();
const second = new WasmCore();
assert.equal(first.disposed, false);
assert.equal(second.disposed, false);

const booleanSignal = first.create_signal(true);
const numberSignal = first.create_signal(0);
const stringSignal = first.create_signal("ready");
assert.equal(first.read_signal(booleanSignal), true);
assert.equal(first.read_signal(numberSignal), 0);
assert.equal(first.read_signal(stringSignal), "ready");

assert.equal(first.set_signal(numberSignal, -0), false);
assert.equal(first.set_signal(numberSignal, 1), true);
assert.equal(first.read_signal(numberSignal), 1);
assert.equal(first.set_signal(stringSignal, "updated"), true);
assert.equal(first.read_signal(stringSignal), "updated");
assert.equal(first.set_signal(booleanSignal, true), false);

expectError(() => first.create_signal(NaN), "unsupported_value");
expectError(() => first.create_signal(Infinity), "unsupported_value");
expectError(() => first.create_signal(null), "unsupported_value");
expectError(() => first.create_signal(undefined), "unsupported_value");
expectError(() => first.create_signal([]), "unsupported_value");
expectError(() => first.create_signal({}), "unsupported_value");
expectError(() => first.set_signal(booleanSignal, "wrong-type"), "type_mismatch");

const computation = first.create_computation();
const dependencies = first.create_dependency_list();
dependencies.push(numberSignal);
assert.equal(dependencies.len(), 1);
first.replace_dependencies(computation, dependencies);
assert.equal(first.subscribe(numberSignal, computation), false);
assert.equal(first.unsubscribe(numberSignal, computation), true);
assert.equal(first.subscribe(numberSignal, computation), true);
assert.equal(first.subscribe(numberSignal, computation), false);

first.begin_batch();
first.set_signal(numberSignal, 2);
assert.deepEqual([...first.drain_pending_computations()], []);
first.begin_batch();
first.set_signal(numberSignal, 3);
first.end_batch();
assert.deepEqual([...first.drain_pending_computations()], []);
first.end_batch();
assert.deepEqual([...first.drain_pending_computations()], [0, 0]);

assert.equal(first.set_signal(numberSignal, 4), true);
assert.deepEqual([...first.drain_pending_computations()], [0, 0]);
assert.equal(first.set_signal(numberSignal, 4), false);
assert.deepEqual([...first.drain_pending_computations()], []);

const secondComputation = second.create_computation();
expectError(() => second.subscribe(numberSignal, secondComputation), "foreign_instance");
const foreignDependencies = second.create_dependency_list();
expectError(() => foreignDependencies.push(numberSignal), "foreign_instance");

first.dispose_computation(computation);
expectError(() => first.dispose_computation(computation), "stale_handle");
first.dispose_signal(numberSignal);
expectError(() => first.read_signal(numberSignal), "stale_handle");
first.dispose_signal(booleanSignal);
first.dispose_signal(stringSignal);
first.dispose();
assert.equal(first.disposed, true);
expectError(() => first.create_signal(false), "disposed_instance");
expectError(() => first.dispose(), "disposed_instance");

second.dispose_computation(secondComputation);
second.dispose();

console.log("M2.2 WASM bridge smoke test passed");
