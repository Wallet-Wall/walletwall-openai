import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";

const schemas = {
  "plugin.schema.json": "c34bf688ea19a772c168cdea115ff8ffd7c3529529f53be148a9c79fcc0ed657bc34a250b7f0f46c76f354a83390ac3d730ea1654a279dbdc6463ec96cfa9a28",
  "mcp.schema.json": "591767379bbee668ed0d58d125bc4f4ce2c6d15b81834ae57ab7f2f7e5e8e890e4915631b8b04fbb500fd5f2e864853f982a4a0c09599e9fe4a28ea3ceb450f0",
};
const folder = ".upstream/agent-plugins";
await mkdir(folder, { recursive: true });
const ajv = new Ajv2020({ strict: false });
for (const [name, digest] of Object.entries(schemas)) {
  const filename = folder + "/" + name;
  let bytes;
  try {
    bytes = await readFile(filename);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    bytes = execFileSync("curl", ["--fail", "--silent", "--show-error", "--proto", "=https",
      "--max-time", "15", "https://agent-plugins.org/schemas/1.0.0/" + name], { maxBuffer: 1024 * 1024 });
  }
  if (createHash("sha512").update(bytes).digest("hex") !== digest) throw Error("Agent Plugins schema integrity mismatch.");
  ajv.addSchema(JSON.parse(bytes), name);
  await writeFile(filename, bytes);
}
if (process.argv[2] === "--validate-stdin") {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const pair = JSON.parse(Buffer.concat(chunks));
  for (const key of ["plugin", "mcp"]) {
    const validate = ajv.getSchema(key + ".schema.json");
    if (!validate(pair[key])) {
      console.error(key + ".json failed Agent Plugins schema validation.", validate.errors);
      process.exitCode = 1;
    }
  }
}
