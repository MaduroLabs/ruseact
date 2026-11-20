import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingDirectory = process.env.RUSEACT_BROWSER_BINDGEN_OUT;
if (bindingDirectory === undefined) {
  throw new Error("RUSEACT_BROWSER_BINDGEN_OUT must point to generated web bindings");
}

const outputPath = path.resolve(
  process.env.RUSEACT_M35_BENCHMARK_OUT ?? "/tmp/ruseact-m3.5-dom-results.json",
);
const summaryPath = path.resolve(
  process.env.RUSEACT_M35_BENCHMARK_SUMMARY_OUT ?? outputPath.replace(/\.json$/u, ".md"),
);

function findBrowser() {
  const candidates = [
    process.env.RUSEACT_BROWSER,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ["--version"], { encoding: "utf8" }).trim();
      return { command: candidate, version };
    } catch {
      // Continue through the configured candidate list.
    }
  }
  throw new Error("no supported Chromium executable found");
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
      "packages",
      "--outDir",
      outputDirectory,
      "packages/ruseact/src/index.ts",
      "packages/ruseact-dom/src/host.ts",
      "packages/ruseact-dom/src/bindings.ts",
      "packages/ruseact-dom/src/root.ts",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function browserPage(sourceSha, browserVersion, toolchain) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Ruseact M3.5 DOM benchmark</title></head>
<body data-status="pending">
<script type="module">
  import initializeWasm, * as wasm from "./generated/ruseact_wasm.js";
  import * as runtimeModule from "./ruseact/src/index.js";
  import * as rootModule from "./ruseact-dom/src/root.js";
  import { runDomBenchmarks } from "./dom_benchmark_workloads.mjs";

  const sourceSha = ${JSON.stringify(sourceSha)};
  const browserVersion = ${JSON.stringify(browserVersion)};
  const toolchain = ${JSON.stringify(toolchain)};

  function publish(value) {
    document.body.dataset.status = value.error === undefined ? "passed" : "failed";
    document.body.dataset.testResult = encodeURIComponent(JSON.stringify(value));
  }

  function estimateTimerResolutionNs() {
    let previous = performance.now();
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 0; index < 10000; index += 1) {
      const current = performance.now();
      if (current > previous) minimum = Math.min(minimum, (current - previous) * 1000000);
      previous = current;
    }
    return Number.isFinite(minimum) ? minimum : null;
  }

  try {
    await initializeWasm();
    const timerResolutionNs = estimateTimerResolutionNs();
    const report = await runDomBenchmarks({
      clock: {
        now: () => performance.now(),
        toNs: (value) => value * 1000000,
        resolutionNs: timerResolutionNs,
      },
      runtimeModule,
      rootModule,
      wasmModule: wasm,
      metadata: {
        source_sha: sourceSha,
        browser: browserVersion,
        ...toolchain,
        user_agent: navigator.userAgent,
        host: navigator.platform,
        cross_origin_isolated: globalThis.crossOriginIsolated === true,
        timer: "performance.now() converted to nanoseconds",
        timer_resolution_ns: timerResolutionNs,
        wasm_build: "wasm32-unknown-unknown release with wasm-bindgen --target web",
        completion: "Chromium DevTools Protocol Runtime.evaluate with a real-time parent timeout",
      },
    });
    publish(report);
  } catch (error) {
    publish({ error: error instanceof Error ? error.message : String(error) });
  }
</script>
</body></html>`;
}

function monotonicNowNs() {
  return process.hrtime.bigint();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function allocatePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("failed to allocate DevTools port");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function devtoolsTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`DevTools target endpoint returned ${response.status}`);
  return await response.json();
}

async function waitForPageTarget(port, expectedUrl, deadlineNs) {
  let lastError;
  while (monotonicNowNs() < deadlineNs) {
    try {
      const targets = await devtoolsTargets(port);
      const target = targets.find((entry) => entry.type === "page" && entry.url === expectedUrl);
      if (target?.webSocketDebuggerUrl !== undefined) return target;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for Chromium DevTools page${lastError === undefined ? "" : `: ${lastError.message}`}`);
}

class DevToolsClient {
  constructor(webSocketUrl) {
    const parsed = new URL(webSocketUrl);
    this.host = parsed.hostname;
    this.port = Number(parsed.port);
    this.path = `${parsed.pathname}${parsed.search}`;
    this.socket = undefined;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.protocolError = undefined;
  }

  async connect() {
    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.on("data", (chunk) => this.receive(chunk));
    this.socket.on("error", (error) => {
      this.protocolError = error;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    await new Promise((resolve, reject) => {
      const onConnect = () => {
        this.socket.off("error", onError);
        resolve();
      };
      const onError = (error) => {
        this.socket.off("connect", onConnect);
        reject(error);
      };
      this.socket.once("connect", onConnect);
      this.socket.once("error", onError);
    });
    const key = randomBytes(16).toString("base64");
    this.socket.write(
      `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("timed out during DevTools WebSocket handshake")), 5000);
      const checkHandshake = () => {
        const end = this.buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        clearTimeout(deadline);
        const headers = this.buffer.subarray(0, end).toString("utf8");
        this.buffer = this.buffer.subarray(end + 4);
        if (!headers.startsWith("HTTP/1.1 101")) reject(new Error(`DevTools WebSocket handshake failed: ${headers}`));
        else {
          this.handshakeCheck = undefined;
          resolve();
        }
      };
      this.handshakeCheck = checkHandshake;
      checkHandshake();
    });
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.handshakeCheck !== undefined) {
      this.handshakeCheck();
      if (this.handshakeCheck !== undefined) return;
    }
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      let offset = 2;
      let length = second & 0x7f;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const largeLength = this.buffer.readBigUInt64BE(2);
        if (largeLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("oversized DevTools frame");
        length = Number(largeLength);
        offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      const opcode = first & 0x0f;
      if (opcode === 0x1) this.handleMessage(payload.toString("utf8"));
      else if (opcode === 0x8) this.close();
      else if (opcode === 0x9) this.sendFrame(0xA, payload);
    }
  }

  handleMessage(text) {
    const message = JSON.parse(text);
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    if (message.error !== undefined) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve(message.result);
  }

  sendFrame(opcode, payload) {
    const mask = randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(method, params = {}) {
    if (this.protocolError !== undefined) return Promise.reject(this.protocolError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sendFrame(0x1, Buffer.from(JSON.stringify({ id, method, params })));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return result?.result?.value;
  }

  close() {
    if (this.socket !== undefined) {
      this.socket.end();
      this.socket = undefined;
    }
  }
}

async function stopBrowser(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    delay(5000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

async function runBrowser(command, args, expectedUrl) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const deadlineNs = monotonicNowNs() + 300000000000n;
  let client;
  try {
    const port = Number(args.find((argument) => argument.startsWith("--remote-debugging-port="))?.split("=")[1]);
    const target = await waitForPageTarget(port, expectedUrl, deadlineNs);
    client = new DevToolsClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    while (monotonicNowNs() < deadlineNs) {
      const encoded = await client.evaluate(`JSON.stringify({status: document.body.dataset.status, result: document.body.dataset.testResult || null})`);
      if (typeof encoded === "string") {
        const state = JSON.parse(encoded);
        if (state.status === "passed" || state.status === "failed") {
          return { status: 0, stdout, stderr, report: state.result === null ? null : JSON.parse(decodeURIComponent(state.result)) };
        }
      }
      await delay(100);
    }
    throw new Error("browser DOM benchmark timed out before publishing a result");
  } finally {
    client?.close();
    await stopBrowser(child);
  }
}

function renderSummary(report) {
  const lines = [
    "# M3.5 end-to-end DOM benchmark summary",
    "",
    `Source SHA: \`${report.metadata.source_sha}\``,
    `Browser: ${report.metadata.browser}`,
    `Timer resolution estimate: ${report.metadata.timer_resolution_ns ?? "unavailable"} ns`,
    `Trials: ${report.configuration.trials}; warmups: ${report.configuration.warmups}`,
    `Integrity: ${report.integrity.status}; valid rows: ${report.integrity.valid_rows}; unresolved rows: ${report.integrity.unresolved_rows}; zero-sample rows: ${report.integrity.zero_sample_rows}`,
    "",
    "| Layer | Operation | Size | Phase | Timed ops | Median ns | p95 ns | ns/op |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const row of report.results) {
    lines.push(`| ${row.measurement_layer} | ${row.operation} | ${row.workload_size} | ${row.measurement_phase} | ${row.timed_operations} | ${row.median_ns.toFixed(2)} | ${row.p95_ns.toFixed(2)} | ${row.median_ns_per_operation.toFixed(3)} |`);
  }
  lines.push("", "Raw samples, calibration attempts, and fixture metadata are in the JSON result.", "");
  return `${lines.join("\n")}\n`;
}

const browser = findBrowser();
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "ruseact-m3.5-browser-"));
const generatedOutput = path.join(temporaryRoot, "generated");
cpSync(bindingDirectory, generatedOutput, { recursive: true });
cpSync(path.join(repositoryRoot, "scripts/benchmark_workloads.mjs"), path.join(temporaryRoot, "benchmark_workloads.mjs"));
cpSync(path.join(repositoryRoot, "scripts/dom_benchmark_workloads.mjs"), path.join(temporaryRoot, "dom_benchmark_workloads.mjs"));

const toolchain = {
  node_version: process.version,
  pnpm_version: process.env.RUSEACT_PNPM_VERSION ?? "not supplied",
  rust_version: process.env.RUSEACT_RUST_VERSION ?? "not supplied",
  typescript_version: process.env.RUSEACT_TYPESCRIPT_VERSION ?? "not supplied",
  wasm_bindgen_version: process.env.RUSEACT_WASM_BINDGEN_VERSION ?? "not supplied",
};

let server;
const requests = [];
try {
  compileRuntime(temporaryRoot);
  writeFileSync(path.join(temporaryRoot, "index.html"), browserPage(
    process.env.RUSEACT_BENCHMARK_SOURCE_SHA ?? "not supplied",
    browser.version,
    toolchain,
  ));
  server = createServer((request, response) => {
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
    response.writeHead(200, {
      "content-type": contentType(requestedFile),
      "cache-control": "no-store",
      // Cross-origin isolation permits Chromium's high-resolution monotonic
      // timer path for this measurement page. All benchmark resources are
      // same-origin; the application/runtime semantics are unchanged.
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
    });
    createReadStream(requestedFile).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("browser benchmark server did not bind");
  const devtoolsPort = await allocatePort();
  const benchmarkUrl = `http://127.0.0.1:${address.port}/index.html`;
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
    `--remote-debugging-port=${devtoolsPort}`,
    "--remote-allow-origins=*",
    benchmarkUrl,
  ], benchmarkUrl);
  if (result.report === null || result.report === undefined) {
    throw new Error(`${browser.version} did not publish a report; requests: ${requests.join(", ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  if (result.report.error !== undefined) {
    const errorReport = {
      schema_version: 1,
      benchmark: "m3.5-dom-e2e",
      metadata: {
        source_sha: process.env.RUSEACT_BENCHMARK_SOURCE_SHA ?? "not supplied",
        browser: browser.version,
        ...toolchain,
        error: result.report.error,
      },
      integrity: { status: "error", total_rows: 0, valid_rows: 0, unresolved_rows: 1 },
      results: [],
    };
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(errorReport, null, 2)}\n`);
    writeFileSync(summaryPath, `# M3.5 end-to-end DOM benchmark\n\nBenchmark failed: ${result.report.error}\n`);
    throw new Error(`browser DOM benchmark failed: ${result.report.error}`);
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result.report, null, 2)}\n`);
  writeFileSync(summaryPath, renderSummary(result.report));
  console.log(`M3.5 Chromium DOM benchmark completed: ${result.report.results.length} result rows`);
  console.log(`Integrity: ${result.report.integrity.status}; valid rows: ${result.report.integrity.valid_rows}; unresolved rows: ${result.report.integrity.unresolved_rows}`);
  console.log(`JSON results: ${outputPath}`);
  console.log(`Summary: ${summaryPath}`);
} finally {
  if (server !== undefined) await new Promise((resolve) => server.close(resolve));
  rmSync(temporaryRoot, { recursive: true, force: true });
}
