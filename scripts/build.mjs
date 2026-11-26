import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const options = {
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  write: false,
  metafile: true,
  legalComments: "inline",
  charset: "ascii",
};

const worker = await build({
  ...options,
  entryPoints: ["src/worker.mjs"],
  plugins: [{
    name: "disable-unused-mcp-elicitation-validator",
    setup(build) {
      build.onResolve({ filter: /\/validation\/ajv-provider\.js$/ }, (args) => {
        if (args.importer.includes("/node_modules/@modelcontextprotocol/sdk/")) {
          return { path: "disabled", namespace: "walletwall-elicitation" };
        }
      });
      build.onLoad({ filter: /.*/, namespace: "walletwall-elicitation" }, () => ({
        contents: 'export class AjvJsonSchemaValidator { getValidator() { throw Error("MCP elicitation is disabled."); } }',
      }));
    },
  }],
});
const workerUrl = "data:text/javascript;base64," + Buffer.from(worker.outputFiles[0].contents).toString("base64");
const handler = await build({
  ...options,
  entryPoints: ["src/handler.mjs"],
  plugins: [{
    name: "embed-reviewed-worker",
    setup(build) {
      build.onResolve({ filter: /^walletwall:worker$/ }, () => ({ path: "worker", namespace: "walletwall" }));
      build.onLoad({ filter: /.*/, namespace: "walletwall" }, () => ({ contents: "export default " + JSON.stringify(workerUrl) }));
    },
  }],
});

const packages = new Set();
function checkClosure(artifact, permittedExternal) {
  for (const [path, metadata] of Object.entries(artifact.metafile.inputs)) {
    if (path.startsWith("node_modules/")) {
      const name = path.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)/)?.[1];
      if (!["@modelcontextprotocol/sdk", "zod", "zod-to-json-schema", "content-type"].includes(name)) throw Error("Unexpected runtime package: " + name);
      packages.add(name);
    }
    for (const dependency of metadata.imports) {
      if (dependency.kind === "dynamic-import" || dependency.kind === "require-resolve") {
        throw Error("Dynamic runtime import in " + path);
      }
    }
  }
  for (const output of Object.values(artifact.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (!dependency.external || !permittedExternal.includes(dependency.path)) {
        throw Error("Unexpected final artifact import: " + dependency.path);
      }
    }
  }
}
checkClosure(worker, ["node:worker_threads", "node:crypto"]);
checkClosure(handler, ["node:worker_threads", "node:crypto"]);

const digest = (bytes) => createHash("sha512").update(bytes).digest("hex");
const pin = JSON.parse(await readFile("upstream.json", "utf8"));
const lock = await readFile("package-lock.json");
const locked = JSON.parse(lock);
const closure = {
  upstreamCommit: pin.commit,
  upstreamEngineSha512: pin.engineSha512,
  lockSha512: digest(lock),
  handlerSha512: digest(handler.outputFiles[0].contents),
  workerSha512: digest(worker.outputFiles[0].contents),
  runtimePackages: [...packages].sort().map((name) => ({ name, ...Object.fromEntries(
    ["version", "integrity"].map((key) => [key, locked.packages["node_modules/" + name][key]])
  ) })),
  workerInputs: Object.keys(worker.metafile.inputs).sort(),
  handlerInputs: Object.keys(handler.metafile.inputs).sort(),
};
await mkdir("dist", { recursive: true });
await writeFile("dist/handler.mjs", handler.outputFiles[0].contents);
const notices = await Promise.all(closure.runtimePackages.map(async ({ name, version }) =>
  "## " + name + " " + version + "\n\n" + (await readFile("node_modules/" + name + "/LICENSE", "utf8")).trim()
));
await writeFile("dist/THIRD_PARTY_NOTICES.md", "# Third-party notices for the remote handler\n\n" + notices.join("\n\n") + "\n");
await writeFile("dist/integrity.json", JSON.stringify(closure, null, 2) + "\n");
console.log("Bounded worker and HTTP handler built with a verified runtime import closure.");
