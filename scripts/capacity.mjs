import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createHandler } from "../dist/handler.mjs";
import { createGatewayServer } from "../src/gateway-server.mjs";
import { createPublicAdmission } from "../src/public-admission.mjs";
import { maximumEvidence } from "../test/support/maximum-evidence.mjs";
import { testCertificate, tlsPost } from "../test/support/tls.mjs";

const directory = await mkdtemp(join(tmpdir(), "walletwall-capacity-"));
let server;
let sample;
try {
  const material = await testCertificate(directory, "local");
  const report = new Map();
  const record = (name) => report.set(name, (report.get(name) ?? 0) + 1);
  const engine = createHandler({ admit: createPublicAdmission({ record }) });
  server = createGatewayServer(engine, {
    tls: { cert: material.cert, key: await readFile(material.keyPath), minVersion: "TLSv1.2" },
    expectedHost: "localhost",
    record,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const read = async (file) => JSON.parse(await readFile(new URL("../dist/fixtures/" + file, import.meta.url)));
  const [draft] = await read("normalize-balance.json");
  const established = await read("readiness-established.json");
  const incomplete = await read("readiness-incomplete.json");
  const conflict = await read("conflict-CNF-002.json");
  const maximum = maximumEvidence();
  const workload = [
    ["resolve_asset", { symbol: "USDC" }],
    ["normalize_observation", draft],
    ["inspect_evidence", conflict],
    ["check_invariants", conflict],
    ["trace_provenance", { bundle: established.bundle, assertionId: "a-balance" }],
    ["assess_vault_readiness", established],
    ["assess_vault_readiness", incomplete],
    ["check_invariants", maximum],
  ];

  let peakRss = process.memoryUsage.rss();
  sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage.rss()); }, 25);
  let failures = 0;
  let largestRequest = 0;
  let largestResponse = 0;
  let id = 0;
  const durations = [];
  // 32 requests in eight four-wide bursts at the production refill rate.
  // The final burst exercises four copies of the upstream collection-limit case.
  for (let burst = 0; burst < 8; burst++) {
    const started = performance.now();
    const batch = Array.from({ length: 4 }, (_, index) => {
      if (burst === 7) return workload.at(-1);
      return workload[(burst * 4 + index) % workload.length];
    });
    await Promise.all(batch.map(async ([name, args]) => {
      const message = { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } };
      largestRequest = Math.max(largestRequest, Buffer.byteLength(JSON.stringify(message)));
      const before = performance.now();
      try {
        const response = await tlsPost(port, material.cert, message);
        largestResponse = Math.max(largestResponse, Buffer.byteLength(response.value));
        if (response.status !== 200 || !JSON.parse(response.value).result?.structuredContent) failures++;
      } catch {
        failures++;
      } finally {
        durations.push(performance.now() - before);
        peakRss = Math.max(peakRss, process.memoryUsage.rss());
      }
    }));
    if (burst < 7) await delay(Math.max(0, 2000 - (performance.now() - started)));
  }

  durations.sort((left, right) => left - right);
  const percentile = (quantile) => Math.round(durations[Math.ceil(durations.length * quantile) - 1]);
  const result = {
    requests: id, failures, peakRssMiB: Math.ceil(peakRss / 1024 ** 2), p50Ms: percentile(0.5), p95Ms: percentile(0.95),
    largestRequestBytes: largestRequest, largestResponseBytes: largestResponse, counters: Object.fromEntries(report),
  };
  console.log(JSON.stringify(result, null, 2));
  assert.equal(failures, 0, "Every capacity request must return a complete result.");
  assert.ok(result.p95Ms <= 1500, "The mixed workload p95 should fit the chosen pilot capacity target.");
  assert.ok(result.peakRssMiB <= 512, "The measured process should stay below the service memory high watermark.");
} finally {
  clearInterval(sample);
  if (server) {
    const done = once(server, "close");
    server.shutdown();
    await done;
  }
  await rm(directory, { force: true, recursive: true });
}
