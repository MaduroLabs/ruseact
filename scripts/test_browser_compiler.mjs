import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createReadStream, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingDirectory = process.env.RUSEACT_BROWSER_BINDGEN_OUT;
if (bindingDirectory === undefined) {
  throw new Error("RUSEACT_BROWSER_BINDGEN_OUT must point to --target web wasm-bindgen output");
}
for (const file of ["ruseact_wasm.js", "ruseact_wasm_bg.wasm"]) {
  if (!existsSync(path.join(bindingDirectory, file))) {
    throw new Error(`missing browser binding output: ${path.join(bindingDirectory, file)}`);
  }
}

function findBrowser() {
  const candidates = [
    process.env.RUSEACT_BROWSER,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter((candidate) => candidate !== undefined);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return { command: candidate, version: result.stdout.trim() };
  }
  throw new Error(`no supported Chromium executable found; tried ${candidates.join(", ")}`);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function runBrowser(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 60000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ error, signal: null, status: null, stderr, stdout });
      }
    });
    child.on("close", (status, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({
          error: timedOut ? new Error("browser process timed out") : undefined,
          signal,
          status,
          stderr,
          stdout,
        });
      }
    });
  });
}

function browserPage() {
  return String.raw`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Ruseact M4.3 compiler</title></head>
  <body data-status="pending">
    <p>Running Ruseact compiler checks…</p>
    <script>
      window.__ruseactPublish = (result) => {
        document.body.dataset.status = result.ok ? "passed" : "failed";
        document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
        document.body.textContent = result.ok
          ? "Ruseact compiler tests passed"
          : "Ruseact compiler tests failed";
      };
      const publishFailure = (message) => {
        if (document.body.dataset.status === "pending") {
          window.__ruseactPublish({ ok: false, checks: [], error: message });
        }
      };
      window.addEventListener("error", (event) => publishFailure(event.error?.message ?? event.message));
      window.addEventListener("unhandledrejection", (event) => publishFailure(String(event.reason)));
      window.__ruseactStage = "page-ready";
      window.setTimeout(
        () => publishFailure("compiler watchdog expired at " + window.__ruseactStage),
        20000,
      );
    </script>
    <script type="module">
      const checks = [];
      function check(condition, name) {
        if (!condition) throw new Error("check failed: " + name);
        checks.push(name);
      }
      function resultDetails(result, root) {
        const candidate = result !== null && typeof result === "object" ? result.error : undefined;
        const error = candidate !== null && typeof candidate === "object" ? candidate : {};
        return JSON.stringify({
          kind: typeof error.kind === "string" ? error.kind : null,
          code: typeof error.code === "string" ? error.code : null,
          operation: typeof error.operation === "string" ? error.operation : null,
          resource: typeof error.resource === "string" ? error.resource : null,
          message: typeof error.message === "string" ? error.message : null,
          rootState: root?.state ?? null,
        });
      }
      function value(result, name, root) {
        if (result === null || typeof result !== "object" || result.ok !== true) {
          throw new Error("check failed: " + name + "; result=" + resultDetails(result, root));
        }
        check(true, name);
        return result.value;
      }
      function expectError(result, code, name, root) {
        if (result === null || typeof result !== "object" || result.ok !== false) {
          throw new Error("check failed: " + name + "; result=" + resultDetails(result, root));
        }
        check(true, name + ": result");
        if (result.error?.code !== code) {
          throw new Error("check failed: " + name + "; expected " + code + "; result=" + resultDetails(result, root));
        }
        check(true, name + ": " + code);
      }
      function success(value) {
        return { ok: true, value };
      }

      try {
        window.__ruseactStage = "importing-modules";
        const [{ default: initializeWasm, ...wasm }, runtimeModule, domModule, compiled] = await Promise.all([
          import("./generated/ruseact_wasm.js"),
          import("./ruseact/src/index.js"),
          import("./ruseact-dom/src/index.js"),
          import("./compiled_views.js"),
        ]);
        window.__ruseactStage = "modules-imported";
        await initializeWasm();
        window.__ruseactStage = "wasm-initialized";
        const runtime = value(await runtimeModule.createReactiveCore(() => wasm), "real runtime initializes");

        const helloContainer = document.createElement("main");
        document.body.appendChild(helloContainer);
        const helloRoot = value(domModule.createRoot(helloContainer, runtime), "compiled Hello root creation");
        const helloView = compiled.createHelloView();
        value(helloRoot.mount(helloView), "compiled Hello mount", helloRoot);
        const helloDiv = helloContainer.querySelector("div");
        const helloHeading = helloContainer.querySelector("h1");
        const helloParagraph = helloContainer.querySelector("p");
        check(helloDiv?.className === "compiled", "compiled static attribute");
        check(helloHeading?.textContent === "Hello Ruseact", "compiled Hello heading");
        check(helloParagraph?.textContent === "Compiled from JSX", "compiled Hello paragraph");
        check(helloDiv?.firstElementChild === helloHeading && helloDiv?.lastElementChild === helloParagraph, "compiled DOM ordering");
        value(helloRoot.unmount(), "compiled Hello unmount", helloRoot);
        check(helloContainer.childNodes.length === 0, "compiled Hello cleanup");
        value(helloRoot.dispose(), "compiled Hello dispose", helloRoot);
        document.body.removeChild(helloContainer);

        const count = value(runtime.createSignal(0), "compiled count signal");
        const disabled = value(runtime.createSignal(false), "compiled disabled signal");
        const counterContainer = document.createElement("main");
        const unrelated = document.createElement("aside");
        unrelated.textContent = "preserve";
        counterContainer.appendChild(unrelated);
        document.body.appendChild(counterContainer);
        const counterRoot = value(domModule.createRoot(counterContainer, runtime), "compiled counter root creation");
        const counterView = compiled.createCounterView({ count, disabled, runtime });
        value(counterRoot.mount(counterView), "compiled counter mount", counterRoot);
        const counterSection = counterContainer.querySelector("section");
        const counterText = counterSection?.querySelector("span")?.firstChild;
        const button = counterSection?.querySelector("button");
        const input = counterSection?.querySelector("input");
        const textIdentity = counterText;
        const buttonIdentity = button;
        check(counterText?.nodeValue === "0", "compiled counter initial text");
        check(input?.disabled === false, "compiled counter initial property");
        button?.dispatchEvent(new Event("click"));
        check(value(runtime.get(count), "compiled event changes signal") === 1, "compiled event increments signal");
        check(counterText?.nodeValue === "0", "compiled counter waits for flush");
        value(counterRoot.flush(), "compiled counter flush", counterRoot);
        check(counterText?.nodeValue === "1", "compiled counter text updates");
        check(counterText === textIdentity && button === buttonIdentity, "compiled counter preserves identity");
        button?.dispatchEvent(new Event("click"));
        button?.dispatchEvent(new Event("click"));
        value(counterRoot.flush(), "compiled counter coalesced flush", counterRoot);
        check(counterText?.nodeValue === "3", "compiled counter multiple updates");
        value(runtime.set(disabled, true), "compiled disabled update");
        value(counterRoot.flush(), "compiled property flush", counterRoot);
        check(input?.disabled === true, "compiled property updates");
        const countBeforeUnmount = value(runtime.get(count), "compiled count before unmount");
        value(counterRoot.unmount(), "compiled counter unmount", counterRoot);
        button?.dispatchEvent(new Event("click"));
        check(value(runtime.get(count), "compiled signal after unmount") === countBeforeUnmount, "compiled listener cleanup");
        check(counterContainer.contains(unrelated), "compiled unrelated DOM preservation");
        value(counterRoot.dispose(), "compiled counter dispose", counterRoot);
        check(value(runtime.get(count), "borrowed signal survives compiled cleanup") === countBeforeUnmount, "borrowed runtime survives compiled cleanup");
        value(runtime.dispose(), "application runtime disposal");
        document.body.removeChild(counterContainer);
        window.__ruseactPublish({ ok: true, checks });
      } catch (error) {
        window.__ruseactPublish({
          ok: false,
          checks,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    </script>
  </body>
</html>`;
}

const compilerOutput = mkdtempSync(path.join(repositoryRoot, "target", "m4.3-browser-compiler-"));
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m4.3-browser-"));
const compiledSource = `export function createHelloView() {
  return (
    <div class="compiled">
      <h1>Hello Ruseact</h1>
      <p>Compiled from JSX</p>
    </div>
  );
}

export function createCounterView({ count, disabled, runtime }) {
  return (
    <section>
      <span>{ruseact.bindText([count], ({ runtime: currentRuntime }) => currentRuntime.get(count))}</span>
      <input disabled={ruseact.bindProperty([disabled], ({ runtime: currentRuntime }) => currentRuntime.get(disabled))} />
      <button onClick={() => {
        const current = runtime.get(count);
        if (current.ok) runtime.set(count, current.value + 1);
      }}>Increment</button>
    </section>
  );
}`;
let server;
const requests = [];
try {
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
      "--outDir", compilerOutput,
      "packages/ruseact-compiler/src/index.ts",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  writeFileSync(path.join(compilerOutput, "package.json"), JSON.stringify({ type: "module" }));
  const compiler = await import(pathToFileURL(path.join(compilerOutput, "ruseact-compiler", "src", "index.js")));
  const compiledResult = compiler.compileTsxModule(compiledSource, { fileName: "compiled-fixture.tsx" });
  if (!compiledResult.ok) {
    throw new Error(JSON.stringify(compiledResult.diagnostics));
  }
  writeFileSync(path.join(temporaryRoot, "compiled_views.js"), compiledResult.code);
  const generatedRoot = path.join(temporaryRoot, "generated");
  cpSync(bindingDirectory, generatedRoot, { recursive: true });

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
      "packages/ruseact/src/index.ts",
      "packages/ruseact-dom/src/index.ts",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  writeFileSync(path.join(temporaryRoot, "index.html"), browserPage());
  const browser = findBrowser();
  server = createServer((request, response) => {
    try {
      const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      requests.push(requestPath);
      const relativePath = decodeURIComponent(requestPath).replace(/^\/+/, "");
      const requestedFile = path.resolve(temporaryRoot, relativePath);
      const rootPrefix = temporaryRoot.endsWith(path.sep) ? temporaryRoot : `${temporaryRoot}${path.sep}`;
      if (requestedFile !== temporaryRoot && !requestedFile.startsWith(rootPrefix)) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      if (!existsSync(requestedFile)) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      response.writeHead(200, { "content-type": contentType(requestedFile) });
      createReadStream(requestedFile).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/index.html`;
  const result = await runBrowser(browser.command, [
    "--headless=new",
    "--no-sandbox",
    "--no-proxy-server",
    "--proxy-bypass-list=<-loopback>",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${path.join(temporaryRoot, "chromium-profile")}`,
    "--virtual-time-budget=30000",
    "--dump-dom",
    url,
  ]);
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${browser.version} failed with status ${result.status} and signal ${result.signal}: ${result.error?.message ?? result.stderr}\nrequests: ${requests.join(", ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const encodedResult = result.stdout.match(/data-test-result="([^"]+)"/)?.[1];
  if (encodedResult === undefined) {
    throw new Error(`compiler page did not publish a result; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const testResult = JSON.parse(decodeURIComponent(encodedResult));
  if (!testResult.ok) {
    throw new Error(`compiler browser tests failed after ${testResult.checks.length} checks: ${testResult.error}`);
  }
  console.log(`${browser.version} M4.3 compiler browser tests passed ${testResult.checks.length} checks`);
} finally {
  if (server !== undefined) await new Promise((resolve) => server.close(resolve));
  rmSync(temporaryRoot, { recursive: true, force: true });
  rmSync(compilerOutput, { recursive: true, force: true });
}
