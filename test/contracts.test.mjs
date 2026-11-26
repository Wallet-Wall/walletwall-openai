import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { callTool } from "../.upstream/source/packages/mcp/src/tools.ts";
import { maximumEvidence } from "./support/maximum-evidence.mjs";
import { validOutput } from "../src/output.mjs";
import { createHandler, limits } from "../dist/handler.mjs";

test("all 115 published conformance vectors stay inside the adapter output contracts", async () => {
  const root = new URL("../.upstream/source/conformance/", import.meta.url);
  let count = 0;
  let validated = 0;
  for (const folder of ["evidence", "authority", "freshness", "conflict", "adversarial"]) {
    const dir = new URL(folder + "/", root);
    for (const name of (await readdir(dir)).filter((name) => name.endsWith(".json"))) {
      const { bundle, evaluatedAt } = JSON.parse(await readFile(new URL(name, dir)));
      count++;
      const calls = [
        ["inspect_evidence", { bundle, evaluatedAt }], ["check_invariants", { bundle, evaluatedAt }],
        ["trace_provenance", { bundle, assertionId: bundle?.assertions?.[0]?.id ?? "missing" }],
        ["assess_vault_readiness", { bundle, evaluatedAt, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" }],
      ];
      for (const [tool, args] of calls) {
        const outcome = callTool(tool, args);
        if (outcome.ok) {
          assert.ok(validOutput(tool, outcome.result), name + " " + tool);
          validated++;
        }
      }
    }
  }
  assert.equal(count, 115);
  assert.ok(validated > 100);
});

test("a synthetic bundle at upstream collection limits fits and preserves an invariant result", async () => {
  const args = maximumEvidence();
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "check_invariants", arguments: args } });
  assert.ok(Buffer.byteLength(body) > 1024 * 1024);
  assert.ok(Buffer.byteLength(body) < limits.requestBytes);
  const outcome = callTool("check_invariants", args);
  assert.equal(outcome.ok, true);
  const handler = createHandler();
  const response = await handler(new Request("http://127.0.0.1/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body,
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.result.structuredContent, outcome.result);
});
