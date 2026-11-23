import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputParent = path.join(repositoryRoot, "target");
mkdirSync(outputParent, { recursive: true });
const temporaryRoot = mkdtempSync(path.join(outputParent, "m4.3-compiler-test-"));

function compileCompilerModule() {
  execFileSync(
    path.join(repositoryRoot, "node_modules", ".bin", "tsc"),
    [
      "--target", "ES2022",
      "--module", "ESNext",
      "--moduleResolution", "Bundler",
      "--strict",
      "--skipLibCheck",
      "--declaration", "false",
      "--noEmit", "false",
      "--rootDir", "packages",
      "--outDir", temporaryRoot,
      "packages/ruseact-compiler/src/index.ts",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  writeFileSync(path.join(temporaryRoot, "package.json"), JSON.stringify({ type: "module" }));
}

function diagnosticCodes(result) {
  return result.ok ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);
}

function assertFailure(result, code) {
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes(code), `expected diagnostic ${code}, got ${diagnosticCodes(result).join(", ")}`);
}

try {
  compileCompilerModule();
  const compiler = await import(pathToFileURL(path.join(temporaryRoot, "ruseact-compiler", "src", "index.js")));

  const staticSource = `export function createView() {
  return (
    <div class="counter">
      <h1>Hello Ruseact</h1>
      <p>Compiler MVP</p>
    </div>
  );
}`;
  const staticResult = compiler.compileTsxModule(staticSource, { fileName: "static.tsx" });
  assert.equal(staticResult.ok, true, JSON.stringify(staticResult));
  assert.match(staticResult.code, /protocol: "ruseact\.template"/);
  assert.match(staticResult.code, /templateId: "m4\.3-/);
  assert.equal(staticResult.metadata.nodes.length, 5);
  assert.deepEqual(staticResult.metadata.nodes.map((node) => node.id), ["n0", "n1", "n2", "n3", "n4"]);
  assert.equal(staticResult.metadata.slots.length, 0);
  const staticModulePath = path.join(temporaryRoot, "static-view.mjs");
  writeFileSync(staticModulePath, staticResult.code);
  const staticModule = await import(pathToFileURL(staticModulePath));
  const staticPlan = staticModule.createView().instantiate({ runtime: {} });
  assert.deepEqual(staticPlan.nodes.map((node) => node.id), ["n0", "n1", "n2", "n3", "n4"]);
  assert.equal(staticPlan.nodes[2].text, "Hello Ruseact");
  assert.equal(staticPlan.nodes[4].text, "Compiler MVP");
  assert.equal(staticPlan.nodes[0].attributes[0].name, "class");

  const dynamicSource = `export function createView({ count, disabled, runtime }) {
  return (
    <section class="counter">
      <span>{ruseact.bindText([count], ({ runtime: currentRuntime }) => currentRuntime.get(count))}</span>
      <input disabled={ruseact.bindProperty([disabled], ({ runtime: currentRuntime }) => currentRuntime.get(disabled))} />
      <button onClick={() => { runtime.set(count, 1); }}>Increment</button>
    </section>
  );
}`;
  const dynamicResult = compiler.compileTsxModule(dynamicSource, { fileName: "counter.tsx" });
  assert.equal(dynamicResult.ok, true, JSON.stringify(dynamicResult));
  assert.deepEqual(dynamicResult.metadata.slots.map((slot) => slot.kind), ["text", "property", "listener"]);
  assert.deepEqual(dynamicResult.metadata.slots.map((slot) => slot.id), ["b0", "b1", "l0"]);
  const dynamicModulePath = path.join(temporaryRoot, "dynamic-view.mjs");
  writeFileSync(dynamicModulePath, dynamicResult.code);
  const dynamicModule = await import(pathToFileURL(dynamicModulePath));
  const count = {};
  const disabled = {};
  const runtime = { set() {} };
  const dynamicView = dynamicModule.createView({ count, disabled, runtime });
  const dynamicPlan = dynamicView.instantiate({ runtime });
  assert.deepEqual(dynamicPlan.bindings[0].dependencies, [count]);
  assert.deepEqual(dynamicPlan.bindings[1].dependencies, [disabled]);
  const dynamicText = dynamicPlan.bindings[0].evaluate({
    runtime: { get() { return { ok: true, value: 7 }; } },
  });
  assert.deepEqual(dynamicText, { ok: true, value: "7" });
  const dynamicProperty = dynamicPlan.bindings[1].evaluate({
    runtime: { get() { return { ok: true, value: true }; } },
  });
  assert.deepEqual(dynamicProperty, { ok: true, value: true });

  const repeat = compiler.compileTsxModule(staticSource, { fileName: "static.tsx" });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.code, staticResult.code, "same source must emit stable code");
  assert.equal(repeat.metadata.templateId, staticResult.metadata.templateId);

  assertFailure(compiler.compileTsxModule("const view = <Counter />;", { fileName: "component.tsx" }), "unsupported_component_tag");
  assertFailure(compiler.compileTsxModule("const view = <div {...props} />;", { fileName: "spread.tsx" }), "unsupported_spread_attribute");
  assertFailure(compiler.compileTsxModule("const view = <svg><path /></svg>;", { fileName: "svg.tsx" }), "unsupported_component_tag");
  assertFailure(compiler.compileTsxModule("const view = <div title={value} />;", { fileName: "implicit.tsx" }), "implicit_dynamic_binding");
  assertFailure(compiler.compileTsxModule("const view = <div>{condition ? <b /> : <i />}</div>;", { fileName: "conditional.tsx" }), "implicit_dynamic_binding");
  assertFailure(compiler.compileTsxModule("const view = <>fragment</>;", { fileName: "fragment.tsx" }), "unsupported_fragment");
  assertFailure(compiler.compileTsxModule("const view = <input autofocus={value} />;", { fileName: "property.tsx" }), "implicit_dynamic_binding");
  const located = compiler.compileTsxModule("const view = <div title={value} />;", { fileName: "located.tsx" });
  assertFailure(located, "implicit_dynamic_binding");
  assert.equal(located.ok ? undefined : located.diagnostics[0].location.fileName, "located.tsx");
  assert.equal(located.ok ? undefined : located.diagnostics[0].location.line, 1);

  console.log("M4.3 compiler tests passed: static plans, bindings, closures, diagnostics, and deterministic output");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
