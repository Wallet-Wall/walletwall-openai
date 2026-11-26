import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { on, once } from "node:events";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createInterface } from "node:readline";
import { createGatewayServer } from "../src/gateway-server.mjs";
import { testCertificate, tlsPost } from "./support/tls.mjs";

const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
const options = { timeout: 8000 };
const root = new URL("../", import.meta.url);

test("the public TLS mode accepts an inherited socket, restricts Host, and reloads TLS without renewing the lease", options, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "walletwall-tls-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = await testCertificate(directory, "original");
  const rotated = await testCertificate(directory, "rotated");
  const lease = join(directory, "lease");
  const host = spawn("python3", ["test/support/activate-socket.py", process.execPath, "scripts/serve.mjs", "--fixed-host-tls"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      WALLETWALL_GATEWAY_PUBLIC_ORIGIN: "https://localhost",
      WALLETWALL_GATEWAY_LEASE_FILE: lease,
      WALLETWALL_TLS_KEY: original.keyPath,
      WALLETWALL_TLS_CERT: original.certPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(host, "exit");
  t.after(async () => {
    if (host.exitCode === null && host.signalCode === null) host.kill("SIGTERM");
    await exited;
  });
  const lines = on(createInterface({ input: host.stdout }), "line", { close: ["close"], signal: AbortSignal.timeout(7000) });
  const portLine = (await lines.next()).value[0];
  const selected = /^test socket port (\d+)$/.exec(portLine);
  assert.ok(selected);
  const port = Number(selected[1]);
  assert.equal((await lines.next()).value[0], "WalletWall MCP listening on inherited socket.");
  assert.equal((await stat(lease)).size, 0);

  const ca = [original.cert, rotated.cert];
  const first = await tlsPost(port, ca, ping, {
    host: "localhost:443", "x-forwarded-for": "203.0.113.99", "user-agent": "walletwall-metrics-sentinel",
  });
  assert.equal(first.status, 200);
  assert.match(first.protocol, /^TLSv1\.[23]$/);
  assert.equal(first.fingerprint, new X509Certificate(original.cert).fingerprint256);
  assert.equal((await tlsPost(port, ca, ping, { host: "unapproved.invalid" })).status, 421);

  // A mismatched certificate/key pair fails closed and retains the running context.
  await copyFile(rotated.certPath, original.certPath);
  host.kill("SIGHUP");
  assert.deepEqual(JSON.parse((await lines.next()).value[0]), { event: "walletwall_tls_reload", result: "rejected" });
  assert.equal((await tlsPost(port, ca, ping)).fingerprint, first.fingerprint);
  await copyFile(rotated.keyPath, original.keyPath);
  host.kill("SIGHUP");
  assert.deepEqual(JSON.parse((await lines.next()).value[0]), { event: "walletwall_tls_reload", result: "applied" });
  const final = await tlsPost(port, ca, ping);
  assert.equal(final.fingerprint, new X509Certificate(rotated.cert).fingerprint256);

  host.kill("SIGUSR2");
  const snapshot = (await lines.next()).value[0];
  assert.doesNotMatch(snapshot, /203\.0\.113|walletwall-metrics-sentinel|localhost|fingerprint/);
  const { reason, remaining, counters } = JSON.parse(snapshot);
  assert.equal(reason, "operator_snapshot");
  assert.equal(counters.admitted, 3);
  assert.equal(counters.response_4xx, 1);
  assert.equal(remaining, 9997);
  await lines.return();
  host.kill("SIGTERM");
  assert.deepEqual(await exited, [0, null]);
});

test("a peer that never completes TLS loses its TCP connection and releases capacity", options, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "walletwall-handshake-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cert = await testCertificate(directory, "test");
  const events = [];
  const server = createGatewayServer((_, peer) => {
    assert.equal(peer, "127.0.0.1");
    return new Response("ok");
  }, {
    tls: { cert: cert.cert, key: await readFile(cert.keyPath), minVersion: "TLSv1.2" },
    maxConnections: 1, handshakesMs: 250, record: (name) => events.push(name),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    const done = once(server, "close");
    server.shutdown();
    return done;
  });
  const awaiting = once(server, "connection");
  const client = connect(server.address().port, "127.0.0.1");
  t.after(() => client.destroy());
  const [socket] = await awaiting;
  await once(socket, "close");
  assert.ok(events.includes("handshake_expired"));
  assert.equal((await tlsPost(server.address().port, cert.cert, ping, { "x-forwarded-for": "203.0.113.99" })).status, 200);
});

test("emergency shutdown closes a pending handshake and cancels an active HTTPS exchange", options, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "walletwall-shutdown-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cert = await testCertificate(directory, "test");
  const active = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  const server = createGatewayServer(async (request) => {
    await request.text();
    active.resolve();
    await new Promise((resolve) => request.signal.addEventListener("abort", resolve, { once: true }));
    cancelled.resolve();
    return new Response("cancelled");
  }, { tls: { cert: cert.cert, key: await readFile(cert.keyPath), minVersion: "TLSv1.2" } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { if (server.listening) server.shutdown(); });

  const port = server.address().port;
  const request = assert.rejects(() => tlsPost(port, cert.cert, ping));
  await active.promise;
  const next = once(server, "connection");
  const client = connect(port, "127.0.0.1");
  t.after(() => client.destroy());
  const [pending] = await next;
  const closedPeer = once(pending, "close");
  const closedServer = once(server, "close");
  server.shutdown();
  await Promise.all([closedPeer, closedServer, request, cancelled.promise]);
  await assert.rejects(() => tlsPost(port, cert.cert, ping));
});
