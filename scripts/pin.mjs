import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const pin = JSON.parse(readFileSync("upstream.json", "utf8"));
const cache = resolve(".upstream");
const bare = join(cache, "copilot.git");
mkdirSync(cache, { recursive: true });
const source = process.env.WALLETWALL_COPILOT_DIR ? resolve(process.env.WALLETWALL_COPILOT_DIR) : bare;
const git = (args) => execFileSync("git", ["-C", source, ...args], { maxBuffer: 16 * 1024 * 1024 });
if (source === bare) {
  try {
    statSync(bare);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    execFileSync("git", ["init", "--bare", "--quiet", bare]);
  }
  try {
    git(["cat-file", "-e", pin.commit + "^{commit}"]);
  } catch {
    git(["fetch", "--quiet", "--no-tags", pin.repository, pin.commit]);
  }
}
if (git(["rev-parse", pin.commit + "^{commit}"]).toString().trim() !== pin.commit) throw Error("Unexpected Copilot commit.");

const paths = [
  "packages/mcp/src",
  "packages/mcp/registry",
  "packages/mcp/authority-policies",
  "conformance",
  "plugin/server/walletwall-mcp.mjs",
  "plugin/skills/vault-readiness/SKILL.md",
  "docs/claude-directory/icon.png",
  "security/bundle.sha512",
  "security/tool-manifest.sha512",
  "security/integrity-policy.json",
  "LICENSE",
  "TRADEMARKS.md",
];
const bundle = "plugin/server/walletwall-mcp.mjs";
const skill = "plugin/skills/vault-readiness/SKILL.md";
const icon = "docs/claude-directory/icon.png";
const sha512 = (bytes) => createHash("sha512").update(bytes).digest("hex");
const read = (path) => git(["show", pin.commit + ":" + path]);
const blob = (path) => git(["rev-parse", pin.commit + ":" + path]).toString().trim();

if (blob(bundle) !== pin.engineBlob || sha512(read(bundle)) !== pin.engineSha512 ||
    !read("security/bundle.sha512").toString().startsWith(pin.engineSha512 + "  ")) {
  throw Error("Pinned engine integrity mismatch.");
}
if (blob(skill) !== pin.skillBlob || sha512(read(icon)) !== pin.iconSha512) {
  throw Error("Pinned skill or icon integrity mismatch.");
}

const entries = git(["ls-tree", "-r", "-z", pin.commit, "--", ...paths]).toString().split("\0").filter(Boolean);
for (const entry of entries) {
  const match = /^100(?:644|755) blob [0-9a-f]{40}\t([a-zA-Z0-9_.\/-]+)$/.exec(entry);
  if (!match || match[1].split("/").some((part) => ["", ".", ".."].includes(part))) {
    throw Error("Unexpected entry in pinned source.");
  }
  const path = match[1];
  const target = join(cache, "source", path);
  mkdirSync(dirname(target), { recursive: true });
  const bytes = read(path);
  const header = Buffer.from("blob " + bytes.length + "\0");
  const actual = createHash("sha1").update(header).update(bytes).digest("hex");
  if (actual !== entry.split(" ")[2].split("\t")[0]) throw Error("Upstream object mismatch.");
  writeFileSync(target, bytes);
}
console.log("Verified Copilot source, bundle, skill and icon at " + pin.commit);
