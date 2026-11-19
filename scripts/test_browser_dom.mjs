import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    if (result.status === 0) {
      return { command: candidate, version: result.stdout.trim() };
    }
  }
  throw new Error(`no supported Chromium executable found; tried ${candidates.join(", ")}`);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
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
  <head><meta charset="utf-8"><title>Ruseact M3.2 DOM host tests</title></head>
  <body data-status="pending">
    <p>Running Ruseact DOM host tests…</p>
    <script>
      window.__ruseactPublish = (result) => {
        document.body.dataset.status = result.ok ? "passed" : "failed";
        document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
        document.body.textContent = result.ok
          ? "Ruseact DOM host tests passed"
          : "Ruseact DOM host tests failed";
      };
      const publishFailure = (message) => {
        if (document.body.dataset.status === "pending") {
          window.__ruseactPublish({ ok: false, checks: [], error: message });
        }
      };
      window.addEventListener("error", (event) => publishFailure(event.error?.message ?? event.message));
      window.addEventListener("unhandledrejection", (event) => publishFailure(String(event.reason)));
      window.setTimeout(() => publishFailure("DOM host test watchdog expired"), 15000);
    </script>
    <script type="module">
      import { createHostContext, HTML_NAMESPACE } from "./dom/host.js";

      const checks = [];
      function check(condition, name) {
        if (!condition) throw new Error("check failed: " + name);
        checks.push(name);
      }
      function expectError(callback, code, name) {
        try {
          callback();
        } catch (error) {
          check(error?.name === "DomHostError", name + ": error type");
          check(error?.code === code, name + ": " + code);
          return;
        }
        throw new Error("expected " + code + ": " + name);
      }

      try {
        const context = createHostContext(document);
        const foreignContext = createHostContext(document);
        const container = document.createElement("main");
        const unrelated = document.createElement("aside");
        unrelated.textContent = "preserve me";
        document.body.appendChild(container);
        container.appendChild(unrelated);
        context.claimContainer(container);

        const root = context.createElement("div");
        context.appendChild(container, root);
        const text = context.createTextNode("<escaped>&text");
        context.appendChild(root, text);
        check(root.textContent === "<escaped>&text", "text is created without HTML parsing");
        check(context.setText(text, "updated <text>"), "text update changes value");
        check(!context.setText(text, "updated <text>"), "unchanged text skips DOM write");
        check(root.textContent === "updated <text>", "text content is safe and correct");

        const namespaced = context.createElement("div", HTML_NAMESPACE);
        check(namespaced.namespaceURI === HTML_NAMESPACE, "explicit HTML namespace uses createElementNS");
        context.appendChild(root, namespaced);
        expectError(
          () => context.createElement("svg", "http://www.w3.org/2000/svg"),
          "unsupported_namespace",
          "unsupported SVG namespace is rejected",
        );
        expectError(() => context.createElement("bad name"), "invalid_element_name", "invalid element name is rejected");

        check(context.setAttribute(root, "data-state", "one"), "attribute insertion");
        check(root.getAttribute("data-state") === "one", "attribute value is visible");
        check(context.setAttribute(root, "data-state", "two"), "attribute replacement");
        check(!context.setAttribute(root, "data-state", "two"), "unchanged attribute skips DOM write");
        check(context.removeAttribute(root, "data-state"), "attribute removal");
        check(!context.removeAttribute(root, "data-state"), "missing attribute removal is idempotent");
        expectError(() => context.setAttribute(root, "bad name", "x"), "invalid_attribute", "invalid attribute is rejected");
        expectError(
          () => context.setAttribute(root, "data-state", "x", "http://www.w3.org/2000/svg"),
          "unsupported_namespace",
          "unsupported attribute namespace is rejected",
        );

        const input = context.createElement("input");
        context.appendChild(root, input);
        check(context.setProperty(input, "value", "hello"), "input value property update");
        check(!context.setProperty(input, "value", "hello"), "unchanged value skips DOM write");
        check(context.setProperty(input, "checked", true), "checked property update");
        check(context.setProperty(input, "disabled", true), "disabled property update");
        check(input.value === "hello" && input.checked && input.disabled, "native properties retain behavior");
        expectError(() => context.setProperty(root, "value", "bad"), "invalid_property", "value rejects incompatible element");
        expectError(() => context.setProperty(input, "tabIndex", 1), "invalid_property", "arbitrary property is rejected");
        expectError(() => context.setProperty(input, "checked", "yes"), "invalid_property_value", "property type is validated");

        const list = context.createElement("ul");
        const first = context.createElement("li");
        const second = context.createElement("li");
        const inserted = context.createElement("li");
        context.appendChild(root, list);
        context.appendChild(list, first);
        context.appendChild(list, second);
        context.insertBefore(list, inserted, second);
        check(list.children[0] === first && list.children[1] === inserted && list.children[2] === second, "insertion preserves order");
        check(list.children[1] === inserted, "inserted node identity is stable");
        const unattachedAnchor = context.createElement("li");
        expectError(() => context.insertBefore(list, first, unattachedAnchor), "invalid_insertion_anchor", "anchor relationship is validated");
        expectError(() => context.insertBefore(text, first), "invalid_parent", "text cannot be an insertion parent");

        const foreignNode = foreignContext.createElement("span");
        expectError(() => context.appendChild(list, foreignNode), "foreign_node", "foreign child is rejected");
        const foreignContainer = document.createElement("div");
        foreignContext.claimContainer(foreignContainer);
        expectError(() => context.appendChild(foreignContainer, first), "foreign_node", "foreign parent is rejected");

        context.removeChild(list, first);
        check(first.parentNode === null, "remove child detaches only the selected node");
        expectError(() => context.setAttribute(first, "data-stale", "x"), "detached_node", "detached node mutation is rejected");
        expectError(() => context.removeChild(list, first), "detached_node", "repeated detached removal is rejected");
        const externallyDetached = context.createElement("section");
        const externallyDetachedText = context.createTextNode("external removal");
        context.appendChild(root, externallyDetached);
        context.appendChild(externallyDetached, externallyDetachedText);
        root.removeChild(externallyDetached);
        expectError(
          () => context.setText(externallyDetachedText, "must fail"),
          "detached_node",
          "external ancestor removal is detected",
        );

        const button = context.createElement("button");
        context.appendChild(root, button);
        let clicks = 0;
        const handler = () => { clicks += 1; };
        check(context.addEventListener(button, "click", handler), "event listener registration");
        check(!context.addEventListener(button, "click", handler), "duplicate listener is idempotent");
        button.dispatchEvent(new Event("click"));
        check(clicks === 1, "native event dispatch invokes handler");
        context.removeEventListener(button, "click", handler);
        button.dispatchEvent(new Event("click"));
        check(clicks === 1, "listener removal prevents later dispatch");
        expectError(() => context.removeEventListener(button, "click", handler), "invalid_listener", "unknown listener removal is rejected");

        let onceClicks = 0;
        const onceHandler = () => { onceClicks += 1; };
        const onceOptions = { once: true };
        check(context.addEventListener(button, "click", onceHandler, onceOptions), "once listener registration");
        button.dispatchEvent(new Event("click"));
        check(onceClicks === 1, "once listener dispatches once");
        check(context.addEventListener(button, "click", onceHandler, onceOptions), "once listener record is released");
        button.dispatchEvent(new Event("click"));
        check(onceClicks === 2, "re-registered once listener dispatches");

        expectError(() => context.appendChild(foreignContainer, root), "foreign_node", "foreign context cannot move owned node");
        foreignContext.dispose();
        expectError(() => foreignContext.createElement("div"), "disposed_context", "disposed foreign context rejects operations");

        const cleanupButton = context.createElement("button");
        let cleanupClicks = 0;
        context.appendChild(root, cleanupButton);
        context.addEventListener(cleanupButton, "click", () => { cleanupClicks += 1; });
        context.dispose();
        cleanupButton.dispatchEvent(new Event("click"));
        check(cleanupClicks === 0, "dispose removes event listeners");
        check(container.contains(unrelated), "dispose preserves unrelated container nodes");
        check(!container.contains(root), "dispose removes owned DOM nodes");
        expectError(() => context.createTextNode("after dispose"), "disposed_context", "disposed context rejects creation");

        report({ ok: true, checks });
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

const browser = findBrowser();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m3.2-browser-"));
const domOutput = path.join(temporaryRoot, "dom");
mkdirSync(domOutput, { recursive: true });
let server;
const requests = [];

try {
  execFileSync(
    "corepack",
    [
      "pnpm",
      "exec",
      "tsc",
      "--target",
      "ES2022",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--strict",
      "--skipLibCheck",
      "--declaration",
      "false",
      "--noEmit",
      "false",
      "--rootDir",
      "packages/ruseact-dom/src",
      "--outDir",
      domOutput,
      "packages/ruseact-dom/src/host.ts",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );

  writeFileSync(path.join(temporaryRoot, "index.html"), browserPage());
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
    "--virtual-time-budget=20000",
    "--dump-dom",
    url,
  ]);

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `${browser.version} failed with status ${result.status} and signal ${result.signal}: ${result.error?.message ?? result.stderr}\nrequests: ${requests.join(", ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  const encodedResult = result.stdout.match(/data-test-result="([^"]+)"/)?.[1];
  if (encodedResult === undefined) {
    throw new Error(`DOM host page did not publish a result; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const testResult = JSON.parse(decodeURIComponent(encodedResult));
  if (!testResult.ok) {
    throw new Error(`DOM host tests failed after ${testResult.checks.length} checks: ${testResult.error}`);
  }
  console.log(`${browser.version} Ruseact DOM host tests passed ${testResult.checks.length} checks`);
} finally {
  if (server !== undefined) {
    await new Promise((resolve) => server.close(resolve));
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
