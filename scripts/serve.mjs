import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createAdmission, createForwarder, createHandler } from "../dist/handler.mjs";
import { claimGatewayLease } from "../src/gateway-lease.mjs";

const publicOrigin = process.env.WALLETWALL_GATEWAY_PUBLIC_ORIGIN;
const port = Number(process.env.PORT ?? 3000);
const proxy = process.argv.includes("--gateway");
const dispatch = proxy ? createForwarder({
  url: process.env.WALLETWALL_VERCEL_ORIGIN,
  originKey: process.env.WALLETWALL_ORIGIN_KEY,
  protectionBypass: process.env.WALLETWALL_VERCEL_BYPASS,
}) : undefined;
if (proxy && (!publicOrigin || new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith("https://"))) {
  throw Error("An exact public HTTPS origin is required for gateway mode.");
}

if (proxy) claimGatewayLease(process.env.WALLETWALL_GATEWAY_LEASE_FILE);
const admit = proxy ? createAdmission() : createAdmission({ burst: 64, perMinute: 600 });
const handle = createHandler({ allowedOrigins: [publicOrigin ?? "http://127.0.0.1:" + port], dispatch, admit });
const inFlight = new Set();
const server = createServer({ headersTimeout: 3500, requestTimeout: 4000, keepAliveTimeout: 3000, maxHeaderSize: 8192 }, async (incoming, outgoing) => {
  const abort = new AbortController();
  inFlight.add(abort);
  outgoing.once("close", () => abort.abort());
  try {
    if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) {
      outgoing.writeHead(400, { "cache-control": "no-store" }).end();
      return;
    }
    const hasBody = !["GET", "HEAD"].includes(incoming.method);
    const request = new Request(new URL(incoming.url, "http://127.0.0.1"), {
      method: incoming.method, headers: incoming.headers, signal: abort.signal,
      ...(hasBody && { body: Readable.toWeb(incoming), duplex: "half" }),
    });
    const response = await handle(request);
    if (outgoing.destroyed) return;
    // Each response is bounded by the worker or upstream body cap.
    const data = Buffer.from(await response.arrayBuffer());
    const outgoingHeaders = Object.fromEntries(response.headers);
    if (!incoming.complete) {
      outgoingHeaders.connection = "close";
      outgoing.once("finish", () => incoming.destroy());
    }
    outgoing.writeHead(response.status, outgoingHeaders).end(data);
  } catch {
    if (!outgoing.headersSent && !outgoing.destroyed) {
      outgoing.writeHead(500, { "cache-control": "no-store", connection: "close" }).end();
    } else {
      outgoing.destroy();
    }
  } finally {
    inFlight.delete(abort);
  }
});
server.maxConnections = 32;
const disable = () => {
  server.close();
  for (const controller of inFlight) controller.abort();
  server.closeAllConnections();
};
process.once("SIGTERM", disable);
process.once("SIGINT", disable);
server.listen(port, "127.0.0.1", () => console.log("WalletWall MCP listening on loopback."));
