import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const expectedTools = [
  "resolve_asset", "normalize_observation", "inspect_evidence",
  "check_invariants", "trace_provenance", "assess_vault_readiness",
];
const root = new URL("../", import.meta.url);
const engine = new URL(".upstream/source/plugin/server/walletwall-mcp.mjs", root);
const example = "walletwall://examples/vault-readiness-";
const fixture = async (name) => JSON.parse(await readFile(new URL("dist/fixtures/" + name, root)));
const bind = await import("node:net");
const listener = bind.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));

let host;
const hostLog = [];
let http;
let stdio;
let exampleArgs;
let incompleteArgs;

before(async () => {
  host = spawn(process.execPath, ["scripts/serve.mjs"], { cwd: root, env: { PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  host.stderr.on("data", (chunk) => hostLog.push(chunk.toString()));
  const [ready] = await once(host.stdout, "data");
  assert.match(ready.toString(), /listening on loopback/);
  host.stdout.on("data", (chunk) => hostLog.push(chunk.toString()));
  const info = { name: "walletwall-review-test", version: "1" };
  http = new Client(info);
  stdio = new Client(info);
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [engine.pathname], stderr: "pipe" }));
  await http.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:" + port + "/mcp")));
  const args = async (kind) => {
    const reply = await http.readResource({ uri: example + kind });
    return JSON.parse(reply.contents[0].text).toolCall.arguments;
  };
  exampleArgs = await args("established");
  incompleteArgs = await args("not-established");
});

after(async () => {
  await http?.close();
  await stdio?.close();
  if (host && host.exitCode === null && host.signalCode === null) {
    const exited = once(host, "exit");
    host.kill("SIGTERM");
    const [code, signal] = await exited;
    assert.equal(code, 0);
    assert.equal(signal, null);
    await assert.rejects(() => fetch("http://127.0.0.1:" + port + "/mcp", { signal: AbortSignal.timeout(500) }));
  }
  assert.deepEqual(hostLog, []);
});

async function parity(name, args) {
  const [local, remote] = await Promise.all([
    stdio.callTool({ name, arguments: args }),
    http.callTool({ name, arguments: args }),
  ]);
  assert.deepEqual(remote, local, name);
  return remote.structuredContent;
}

test("MCP connects, discovers exactly six schema-bearing tools and enumerates identical resources", async () => {
  const [local, remote] = await Promise.all([stdio.listTools(), http.listTools()]);
  assert.deepEqual(remote.tools.map((tool) => tool.name), expectedTools);
  assert.equal(http.getServerVersion().version, stdio.getServerVersion().version);
  for (const [index, { outputSchema, ...tool }] of remote.tools.entries()) {
    assert.equal(outputSchema.type, "object");
    assert.equal(outputSchema.additionalProperties, false);
    assert.deepEqual(tool, local.tools[index]);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
  }
  assert.deepEqual(await http.listResources(), await stdio.listResources());
});

test("P1 exact deployment and symbol-only candidates", async () => {
  const address = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const exact = await parity("resolve_asset", { chainId: "1", address });
  assert.equal(exact.resolution, "REGISTRY_MATCH");
  assert.equal(exact.supportState, "PARTIAL");
  assert.equal(exact.asset.address, address);
  const symbol = await parity("resolve_asset", { symbol: "USDC" });
  assert.equal(symbol.resolution, "SYMBOL_CANDIDATES");
  assert.equal(symbol.candidates.length, 3);
});

test("P2 normalized canonical JSON and digest parity", async () => {
  const [draft, second] = await fixture("normalize-balance.json");
  const normalized = await parity("normalize_observation", draft);
  const repeated = await parity("normalize_observation", second);
  const { token, blockHash } = exampleArgs.bundle.observations.find(({ id }) => id === "obs-balance").subject;
  assert.equal(normalized.balanceDecimal, "1.5");
  assert.equal(normalized.observation.subject.token, token);
  assert.equal(normalized.observation.subject.blockHash, blockHash);
  assert.equal(normalized.contentDigest, repeated.contentDigest);
  assert.notEqual(normalized.evidenceDigest, repeated.evidenceDigest);
});

test("P3 inspect the two conflicting balance assertions", async () => {
  const result = await parity("inspect_evidence", await fixture("conflict-CNF-002.json"));
  assert.deepEqual(result.assertions.filter((a) => a.supportState === "CONFLICTING").map((a) => a.assertionId),
    ["a-balance", "a-balance-2"]);
});

test("P4 invariants and assertion provenance", async () => {
  const { bundle, evaluatedAt } = exampleArgs;
  const invariants = await parity("check_invariants", { bundle, evaluatedAt });
  assert.equal(invariants.pass, true);
  assert.equal(invariants.violationCount, 0);
  const provenance = await parity("trace_provenance", { bundle, assertionId: "a-balance" });
  assert.equal(provenance.target, "a-balance");
  assert.ok(Object.values(provenance.prov.agent).some((attrs) => attrs["ww:retrievedVia"] === "ExampleRpcProvider"));
});

test("P5 established synthetic readiness", async () => {
  const result = await parity("assess_vault_readiness", exampleArgs);
  assert.equal(result.classification, "CRITERIA_MET");
  assert.deepEqual(result.criteria.map(({ id, outcome }) => [id, outcome]),
    Array.from({ length: 6 }, (_, i) => ["C" + (i + 1), "MET"]));
});

test("N1 incomplete and stale evidence fail closed", async () => {
  assert.equal((await parity("assess_vault_readiness", incompleteArgs)).classification, "NOT_ESTABLISHED");
  const stale = await parity("assess_vault_readiness", { ...exampleArgs, evaluatedAt: "2027-10-23T12:00:30Z" });
  assert.equal(stale.classification, "NOT_ESTABLISHED");
  assert.ok(stale.limitations.includes("STALE_EVIDENCE"));
});

test("N2 no transaction tool or input for secrets is exposed", async () => {
  assert.deepEqual((await http.listTools()).tools.map((tool) => tool.name), expectedTools);
  const result = await http.callTool({ name: "transfer", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).error.code, "UNKNOWN_TOOL");
});

test("N3 instruction-like provenance stays data and does not change readiness", async () => {
  const untrusted = await fixture("provenance-label.json");
  const { bundle } = untrusted;
  const provenance = await parity("trace_provenance", { bundle, assertionId: "a-balance" });
  assert.ok(Object.values(provenance.prov.agent).some((attrs) => attrs["ww:retrievedVia"].includes("REVIEW_MARKER")));
  assert.equal((await parity("assess_vault_readiness", untrusted)).classification, "CRITERIA_MET");
});

test("validation and protocol errors contain no supplied input details", async () => {
  const reply = await http.callTool({ name: "resolve_asset", arguments: { unexpectedField: "WALLETWALL_SYNTHETIC_SENTINEL" } });
  assert.equal(reply.isError, true);
  assert.doesNotMatch(JSON.stringify(reply), /WALLETWALL_SYNTHETIC_SENTINEL|unexpectedField/);
  await assert.rejects(() => http.readResource({ uri: "walletwall://unknown/SYNTHETIC_SENTINEL" }),
    (error) => !error.message.includes("SYNTHETIC_SENTINEL"));
});
