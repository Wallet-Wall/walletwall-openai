import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHandler } from "../dist/handler.mjs";
import { createGatewayServer } from "../src/gateway-server.mjs";
import { limits } from "../src/limits.mjs";

const loopback = "127.0.0.1";
const options = { timeout: 5000 };
const accept = "application/json, text/event-stream";
const ping = '{"jsonrpc":"2.0","id":1,"method":"ping"}';

async function listen(t, handle, config) {
  const server = createGatewayServer(handle, config);
  server.listen(0, loopback);
  await once(server, "listening");
  t.after(() => {
    const done = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    return done;
  });
  return server;
}

async function peer(t, server) {
  const accepted = once(server, "connection");
  const client = connect(server.address().port, loopback);
  t.after(() => client.destroy());
  // A deadline can reset a socket that still has a queued write.
  client.on("error", () => {});
  const [socket] = await accepted;
  return {
    client,
    socket,
    closed: new Promise((resolve) => socket.once("close", resolve)),
  };
}

function post(server) {
  return postPort(server.address().port);
}

function postPort(port) {
  return fetch("http://" + loopback + ":" + port + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept },
    body: ping,
    signal: AbortSignal.timeout(2000),
  });
}

function requestText(body, length = Buffer.byteLength(body)) {
  return "POST /mcp HTTP/1.1\r\nHost: localhost\r\n" +
    "Content-Type: application/json\r\nAccept: " + accept + "\r\n" +
    "Content-Length: " + length + "\r\n\r\n" + body;
}

test("a slow reader holds one response slot until the fixed write deadline, then service recovers", options, async (t) => {
  const sendRemainder = Promise.withResolvers();
  t.after(() => sendRemainder.resolve());
  const prefix = new TextEncoder().encode("walletwall test response");
  const server = await listen(t, async (request) => {
    await request.text();
    if (!request.headers.has("x-test-large-response")) return new Response("ok");
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(prefix);
      },
      async pull(controller) {
        await sendRemainder.promise;
        controller.enqueue(new Uint8Array(limits.responseBytes - prefix.byteLength));
        controller.close();
      },
    }));
  }, { maxActive: 1, headerMs: 1000, writeMs: 600, socketMs: 3000 });

  const received = once(server, "request");
  const slow = await peer(t, server);
  const firstBytes = once(slow.client, "data");
  slow.client.write(requestText(ping).replace("Host: localhost\r\n", "Host: localhost\r\nX-Test-Large-Response: 1\r\n"));
  const [, outgoing] = await received;
  const started = performance.now();
  const [wire] = await firstBytes;
  assert.match(wire.toString(), /^HTTP\/1\.1 200/);
  slow.client.pause();
  // Hold the socket's remaining writes after a real read. This models
  // sustained backpressure without depending on the kernel's TCP buffer sizes.
  slow.socket.cork();
  sendRemainder.resolve();

  assert.equal((await post(server)).status, 503);
  await slow.closed;
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 450 && elapsed < 1800, "the write deadline closes the socket before its full lifetime");
  assert.equal(outgoing.writableFinished, false);
  assert.equal(await (await post(server)).text(), "ok");
});

test("incomplete headers have an absolute deadline and never reach the handler", options, async (t) => {
  let calls = 0;
  const server = await listen(t, () => {
    calls++;
    return new Response("ok");
  }, { headerMs: 250, socketMs: 3000 });
  const { client, closed } = await peer(t, server);
  client.write("POST /mcp HTTP/1.1\r\nHost: localhost\r\n");
  const started = performance.now();
  const trickle = setInterval(() => client.write("X-Test: partial\r\n"), 35);
  t.after(() => clearInterval(trickle));
  await closed;
  clearInterval(trickle);
  assert.ok(performance.now() - started < 1500, "the header deadline beats the whole-socket ceiling");
  assert.equal(calls, 0);
  assert.equal(await (await post(server)).text(), "ok");
});

test("an incomplete body stays within its socket lifetime and releases capacity", options, async (t) => {
  let dispatched = 0;
  const handle = createHandler({
    dispatch: async () => {
      dispatched++;
      return new Response("ok");
    },
  });
  const server = await listen(t, handle, { maxActive: 1, headerMs: 250, socketMs: 700 });
  const received = once(server, "request");
  const { client, closed } = await peer(t, server);
  client.write(requestText(ping.slice(0, 4), Buffer.byteLength(ping)));
  await received;
  assert.equal((await post(server)).status, 503);
  await closed;
  assert.equal(dispatched, 0);
  assert.equal(await (await post(server)).text(), "ok");
  assert.equal(dispatched, 1);
});

test("the connection ceiling closes excess sockets and accepts work after slots expire", options, async (t) => {
  const server = await listen(t, () => new Response("ok"), { maxConnections: 2, headerMs: 400 });
  const left = await peer(t, server);
  const right = await peer(t, server);
  const dropped = once(server, "drop");
  const excess = connect(server.address().port, loopback);
  t.after(() => excess.destroy());
  excess.on("error", () => {});
  const excessClosed = new Promise((resolve) => excess.once("close", resolve));
  await dropped;
  await excessClosed;
  assert.equal(await new Promise((resolve, reject) => server.getConnections((error, count) => {
    if (error) reject(error);
    else resolve(count);
  })), 2);
  await Promise.all([left.closed, right.closed]);
  assert.equal(await (await post(server)).text(), "ok");
});

test("client disconnect cancels in-flight work and the slot waits for cleanup before recovery", options, async (t) => {
  const running = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  const cleanup = Promise.withResolvers();
  t.after(() => cleanup.resolve());
  let first = true;
  const server = await listen(t, async (request) => {
    await request.text();
    if (first) {
      first = false;
      request.signal.addEventListener("abort", () => cancelled.resolve(), { once: true });
      running.resolve();
      await cleanup.promise;
      return new Response("discarded");
    }
    return new Response("ok");
  }, { maxActive: 1 });

  const { client } = await peer(t, server);
  client.write(requestText(ping));
  await running.promise;
  client.destroy();
  await cancelled.promise;
  assert.equal((await post(server)).status, 503);
  cleanup.resolve();
  assert.equal(await (await post(server)).text(), "ok");
});

test("successful replies close the HTTP connection", options, async (t) => {
  const server = await listen(t, () => new Response(null, { status: 202 }));
  const result = await post(server);
  assert.equal(result.status, 202);
  assert.equal(result.headers.get("connection"), "close");
});

test("fixed-host mode claims a lease and serves the actual local MCP worker", options, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "walletwall-fixed-host-"));
  const lease = join(directory, "lease");
  const child = spawn(process.execPath, ["scripts/serve.mjs", "--fixed-host"], {
    cwd: new URL("../", import.meta.url),
    env: {
      PORT: "0",
      WALLETWALL_GATEWAY_PUBLIC_ORIGIN: "https://walletwall-test.invalid",
      WALLETWALL_GATEWAY_LEASE_FILE: lease,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    await rm(directory, { recursive: true });
  });

  const [ready] = await Promise.race([
    once(child.stdout, "data"),
    exited.then(() => { throw Error("Fixed-host process exited before listening."); }),
  ]);
  const match = /listening on loopback port (\d+)\./.exec(ready.toString());
  assert.ok(match);
  assert.equal((await stat(lease)).size, 0);
  const result = await postPort(Number(match[1]));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { jsonrpc: "2.0", id: 1, result: {} });
  child.kill("SIGTERM");
  assert.deepEqual(await exited, [0, null]);
});
