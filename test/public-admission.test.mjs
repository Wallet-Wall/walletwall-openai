import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdmission } from "../src/admission.mjs";
import { createOperationalMetrics } from "../src/operational-metrics.mjs";
import { createPublicAdmission, publicLimits } from "../src/public-admission.mjs";

function fixture() {
  let now = 0;
  const hits = [];
  return {
    gate: createPublicAdmission({ clock: () => now, admit: () => () => {}, record: (name) => hits.push(name) }),
    hits,
    advance(ms) { now += ms; },
  };
}

test("source limits normalize mapped IPv4 addresses and share one IPv6 /64 quota", () => {
  const { gate, hits, advance } = fixture();
  for (const peer of ["192.0.2.1", "2001:db8:0:10::1"]) {
    for (let i = 0; i < publicLimits.sourceAdmissions; i++) assert.equal(typeof gate(peer), "function");
  }
  assert.equal(gate("::ffff:192.0.2.1"), undefined);
  assert.equal(gate("2001:0db8:0000:0010:abcd::2"), undefined);
  assert.equal(typeof gate("2001:db8:0:11::1"), "function");
  assert.equal(gate(undefined), undefined);
  assert.deepEqual(hits.slice(-4), ["source_limited", "source_limited", "admitted", "invalid_peer"]);
  advance(publicLimits.sourceMs);
  assert.equal(typeof gate("::ffff:c000:201"), "function");
});

test("new sources cannot spend more than the rolling service window", () => {
  const { gate, hits, advance } = fixture();
  for (let i = 0; i < publicLimits.windowAdmissions; i++) {
    assert.equal(typeof gate("2001:db8:" + i.toString(16) + "::1"), "function");
  }
  advance(publicLimits.windowMs - 1);
  assert.equal(gate("2001:db8:ffff::1"), undefined);
  assert.equal(hits.at(-1), "window_limited");
  advance(1);
  assert.equal(typeof gate("2001:db8:ffff::1"), "function");
});

test("soft budgets never grant slots beyond the original aggregate lease or concurrent limit", () => {
  let now = 0;
  const clock = () => now;
  const hits = [];
  const admit = createAdmission({ perBoot: 2, concurrent: 1, clock });
  const gate = createPublicAdmission({ admit, clock, record: (name) => hits.push(name) });
  const release = gate("192.0.2.1");
  assert.equal(typeof release, "function");
  assert.equal(gate("192.0.2.2"), undefined);
  release();
  gate("192.0.2.2")();
  now += publicLimits.windowMs;
  assert.equal(gate("192.0.2.3"), undefined);
  assert.deepEqual(hits, ["admitted", "aggregate_limited", "admitted", "aggregate_limited"]);
});

test("operational snapshots and lease alerts emit only allowlisted counters", () => {
  const lines = [];
  const metrics = createOperationalMetrics((line) => lines.push(line));
  metrics.record("192.0.2.1");
  metrics.record("client-supplied-id");
  metrics.record("window_limited");
  for (let i = 0; i < 9000; i++) metrics.record("admitted");
  metrics.snapshot();
  assert.deepEqual(lines.map((line) => JSON.parse(line).remaining), [3000, 1000, 1000]);
  const snapshot = JSON.parse(lines.at(-1));
  assert.equal(snapshot.counters.window_limited, 1);
  assert.equal(snapshot.counters.admitted, 9000);
  assert.doesNotMatch(lines.join(""), /192\.0\.2|client-supplied-id/);
});
