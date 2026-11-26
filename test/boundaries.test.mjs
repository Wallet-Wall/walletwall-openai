import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createAdmission, createForwarder, createHandler, createOriginHandler, execute, limits } from "../dist/handler.mjs";

const route = "https://example.invalid/mcp";
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const ping = '{"jsonrpc":"2.0","method":"ping","id":1}';
const unknown = "WALLETWALL_SYNTHETIC_SENTINEL";
const key = "a".repeat(64);
const bypass = "synthetic-vercel-gateway-bypass";
const request = (body = ping, overrides = {}) => new Request(route, {
  method: "POST", headers, body, ...overrides,
});
const infiniteLoop = "data:text/javascript," + encodeURIComponent("while (true) {}");

test("the import closure has no Hono, network imports, or validator for unused elicitation", async () => {
  const record = JSON.parse(await readFile(new URL("../dist/integrity.json", import.meta.url)));
  assert.deepEqual(record.runtimePackages.map((pkg) => pkg.name),
    ["@modelcontextprotocol/sdk", "content-type", "zod", "zod-to-json-schema"]);
  assert.doesNotMatch(record.workerInputs.join("\n"), /node_modules\/(hono|@hono|ajv)\//);
  assert.match(record.workerInputs.join("\n"), /walletwall-elicitation:disabled/);
});

test("origin, methods, media type, and version validation fail with fixed responses", async () => {
  const handle = createHandler();
  assert.equal((await handle(request(ping, { headers: { ...headers, origin: "https://unapproved.invalid" } }))).status, 403);
  const get = await handle(new Request(route));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  assert.equal((await handle(request(ping, { headers: { ...headers, "content-type": "text/plain" } }))).status, 415);
  assert.equal((await handle(request(ping, { headers: { ...headers, accept: "application/json" } }))).status, 406);
  const badVersion = await handle(request(ping, { headers: { ...headers, "mcp-protocol-version": unknown } }));
  assert.equal(badVersion.status, 400);
  assert.doesNotMatch(await badVersion.text(), new RegExp(unknown));
  assert.equal((await handle(request(ping, { headers: { ...headers, "mcp-protocol-version": "2025-11-25" } }))).status, 200);
});

test("bounded streaming reads, malformed protocol and nesting, and unsafe object keys are rejected", async () => {
  const handle = createHandler();
  assert.equal((await handle(request(ping, {
    headers: { ...headers, "content-length": String(limits.requestBytes + 1) },
  }))).status, 413);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(limits.requestBytes));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  assert.equal((await handle(request(stream, { duplex: "half" }))).status, 413);
  assert.equal((await handle(request("[" + ping + "]"))).status, 400);
  assert.equal((await handle(request("{"))).status, 400);
  const deeplyNested = '"x":'.padEnd(7) + "[".repeat(40) + "0" + "]".repeat(40);
  assert.equal((await handle(request(ping.slice(0, -1) + "," + deeplyNested + "}"))).status, 400);
  assert.equal((await handle(request(ping.slice(0, -1) + ',"__proto__":{}}'))).status, 400);
  const unknownMethod = await handle(request(ping.replace("ping", unknown)));
  assert.doesNotMatch(await unknownMethod.text(), new RegExp(unknown));
});

test("a synchronous worker is terminated on timeout and on client cancellation", async () => {
  const signal = new AbortController();
  const expired = await execute(new Uint8Array(0), {}, signal.signal, 250, infiniteLoop);
  assert.equal(expired.status, 504);
  const pending = execute(new Uint8Array(0), {}, signal.signal, 10_000, infiniteLoop);
  setTimeout(() => signal.abort(), 250);
  assert.equal((await pending).status, 408);
});

test("an aborted body read releases the shared admission slot", async () => {
  const gate = createAdmission({ concurrent: 1 });
  const handle = createHandler({ admit: gate });
  const controller = new AbortController();
  const stream = new ReadableStream({ start() {} });
  const pending = handle(request(stream, { duplex: "half", signal: controller.signal }));
  assert.equal((await handle(request())).status, 429);
  controller.abort();
  assert.equal((await pending).status, 408);
  assert.equal((await handle(request())).status, 200);
});

test("one aggregate lease controls multiple origin instances and rejects direct origin access", async () => {
  const origins = [createOriginHandler({ enabled: true, originKey: key }), createOriginHandler({ enabled: true, originKey: key })];
  const originUrl = "https://walletwall-synthetic.vercel.app/api/mcp";
  assert.equal((await createOriginHandler()(new Request(originUrl))).status, 503);
  assert.equal((await origins[0](new Request(originUrl, { method: "POST", body: ping, headers }))).status, 403);
  let requests = 0;
  const dispatch = createForwarder({ url: originUrl, originKey: key, protectionBypass: bypass,
    request: (url, options) => {
      assert.equal(url, originUrl);
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["x-vercel-protection-bypass"], bypass);
      return origins[requests++ % origins.length](new Request(url, options));
    },
  });
  let tick = 0;
  const shared = createAdmission({ burst: 2, perBoot: 3, perMinute: 60, clock: () => tick });
  const gateway = createHandler({ admit: shared, dispatch });
  const first = await gateway(request());
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal((await gateway(request())).status, 200);
  assert.equal((await gateway(request())).status, 429);
  tick += 30_000;
  assert.equal((await gateway(request())).status, 200);
  tick += 30_000;
  assert.equal((await gateway(request())).status, 429);
  assert.equal(requests, 3);
});

test("concurrent callers with the same RPC identifier are isolated", async () => {
  const handle = createHandler();
  const requests = ["USDC", "USDT"].map((symbol) => request(JSON.stringify({
    jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "resolve_asset", arguments: { symbol } },
  })));
  const replies = await Promise.all(requests.map(async (value) => {
    const response = await handle(value);
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.deepEqual(replies.map((reply) => reply.id), [11, 11]);
  assert.deepEqual(replies.map((reply) => reply.result.structuredContent.candidates[0].symbol), ["USDC", "USDT"]);
});

test("a gateway budget lease cannot be claimed again after starting", async () => {
  const { mkdtemp, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { claimGatewayLease } = await import("../src/gateway-lease.mjs");
  const folder = await mkdtemp(join(tmpdir(), "walletwall-admission-"));
  try {
    const lease = join(folder, "owner-authorized-budget");
    claimGatewayLease(lease);
    assert.equal((await stat(lease)).size, 0);
    assert.throws(() => claimGatewayLease(lease), /already used/);
  } finally {
    await rm(folder, { recursive: true });
  }
});

test("oversized or provider-owned forwarded responses are withheld", async () => {
  const url = "https://walletwall-synthetic.vercel.app/api/mcp";
  const factory = (response) => createHandler({
    dispatch: createForwarder({ url, originKey: key, protectionBypass: bypass, request: async () => response }),
  });
  const provider = await factory(new Response(unknown, {
    status: 502, headers: { "content-type": "application/json" },
  }))(request());
  assert.equal(provider.status, 502);
  assert.doesNotMatch(await provider.text(), new RegExp(unknown));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(limits.responseBytes));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const oversized = await factory(new Response(stream, {
    headers: { "content-type": "application/json", "x-walletwall-mcp": "1" },
  }))(request());
  assert.equal(oversized.status, 502);
  assert.ok((await oversized.text()).length < 250);
});

test("the evaluation worker does not inherit deployment credentials", async () => {
  const sentinel = "WALLETWALL_TEST_PARENT_ENVIRONMENT";
  process.env[sentinel] = "synthetic";
  try {
    const source = 'import { parentPort } from "node:worker_threads";' +
      'parentPort.postMessage({ status: 200, type: "application/json", body: JSON.stringify(process.env[' +
      JSON.stringify(sentinel) + '] ?? null) });';
    const worker = "data:text/javascript," + encodeURIComponent(source);
    const response = await execute(new Uint8Array(), {}, new AbortController().signal, 1000, worker);
    assert.equal(response.status, 200);
    assert.equal(await response.json(), null);
  } finally {
    delete process.env[sentinel];
  }
});
