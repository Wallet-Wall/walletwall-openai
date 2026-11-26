import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { join } from "node:path";

export async function testCertificate(directory, basename) {
  const keyPath = join(directory, basename + ".key");
  const certPath = join(directory, basename + ".pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
    "-nodes", "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
    "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
  return { keyPath, certPath, cert: await readFile(certPath) };
}

export function tlsPost(port, ca, message, extraHeaders = {}) {
  const body = JSON.stringify(message);
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1", port, servername: "localhost", path: "/mcp", method: "POST", ca, agent: false,
      signal: AbortSignal.timeout(5000),
      headers: {
        host: "localhost", "content-type": "application/json", "content-length": Buffer.byteLength(body),
        accept: "application/json, text/event-stream", ...extraHeaders,
      },
    }, (response) => {
      const fingerprint = response.socket.getPeerCertificate().fingerprint256;
      const protocol = response.socket.getProtocol();
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        const value = Buffer.concat(chunks).toString();
        resolve({ status: response.statusCode, headers: response.headers, value, fingerprint, protocol });
      });
    });
    req.once("error", reject);
    req.end(body);
  });
}
