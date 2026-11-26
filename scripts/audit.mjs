import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const audit = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
if (audit.error) throw audit.error;
const report = JSON.parse(audit.stdout);
if (report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities) throw Error("npm audit did not return a complete report.");
const { runtimePackages } = JSON.parse(readFileSync("dist/integrity.json", "utf8"));
const reachable = new Set(runtimePackages.map(({ name }) => name));
const findings = Object.entries(report.vulnerabilities);
const unacceptable = findings.filter(([name, { severity }]) =>
  reachable.has(name) && ["moderate", "high", "critical"].includes(severity)
);
for (const [name, { severity }] of findings) {
  console.log(severity + " " + name + " (emitted runtime closure: " + reachable.has(name) + ")");
}
console.log("npm audit totals", report.metadata.vulnerabilities);
if (unacceptable.length) throw Error("An emitted dependency requires security review.");
