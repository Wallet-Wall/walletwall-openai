import { constants } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAdmission, createForwarder, createHandler } from "../dist/handler.mjs";
import { claimGatewayLease } from "../src/gateway-lease.mjs";
import { createGatewayServer } from "../src/gateway-server.mjs";
import { createOperationalMetrics } from "../src/operational-metrics.mjs";
import { createPublicAdmission } from "../src/public-admission.mjs";

const publicOrigin = process.env.WALLETWALL_GATEWAY_PUBLIC_ORIGIN;
const port = Number(process.env.PORT ?? 3000);
const proxy = process.argv.includes("--gateway");
const fixedHost = process.argv.includes("--fixed-host");
const directTls = process.argv.includes("--fixed-host-tls");
if ([proxy, fixedHost, directTls].filter(Boolean).length > 1) throw Error("Choose one gateway mode.");
const leased = proxy || fixedHost || directTls;
if (leased && (!publicOrigin || new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith("https://"))) {
  throw Error("An exact public HTTPS origin is required for gateway mode.");
}

let inherited;
if (directTls && (process.env.LISTEN_FDS !== undefined || process.env.LISTEN_PID !== undefined)) {
  if (process.env.LISTEN_FDS !== "1" || process.env.LISTEN_PID !== String(process.pid)) {
    throw Error("Expected one systemd listening socket.");
  }
  inherited = { fd: 3 };
}

function tlsContext() {
  return {
    key: readFileSync(process.env.WALLETWALL_TLS_KEY),
    cert: readFileSync(process.env.WALLETWALL_TLS_CERT),
    minVersion: "TLSv1.2",
    secureOptions: constants.SSL_OP_NO_RENEGOTIATION,
  };
}

const metrics = directTls ? createOperationalMetrics() : undefined;
const dispatch = proxy ? createForwarder({
  url: process.env.WALLETWALL_VERCEL_ORIGIN,
  originKey: process.env.WALLETWALL_ORIGIN_KEY,
  protectionBypass: process.env.WALLETWALL_VERCEL_BYPASS,
}) : undefined;
const admit = directTls ? createPublicAdmission({ record: metrics.record })
  : leased ? createAdmission() : createAdmission({ burst: 64, perMinute: 600 });
const handle = createHandler({ allowedOrigins: [publicOrigin ?? "http://127.0.0.1:" + port], dispatch, admit });
const server = createGatewayServer(handle, {
  tls: directTls ? tlsContext() : undefined,
  expectedHost: directTls ? new URL(publicOrigin).host : undefined,
  record: metrics?.record,
});

if (leased) claimGatewayLease(process.env.WALLETWALL_GATEWAY_LEASE_FILE);

const disable = () => {
  server.shutdown();
  metrics?.shutdown();
};
process.once("SIGTERM", disable);
process.once("SIGINT", disable);
if (directTls) {
  process.on("SIGUSR2", metrics.snapshot);
  process.on("SIGHUP", () => {
    try {
      server.setSecureContext(tlsContext());
      console.log('{"event":"walletwall_tls_reload","result":"applied"}');
    } catch {
      console.log('{"event":"walletwall_tls_reload","result":"rejected"}');
    }
  });
}

server.listen(inherited ?? { port, host: "127.0.0.1" }, () => {
  console.log("WalletWall MCP listening on " + (inherited ? "inherited socket" : "loopback port " + server.address().port) + ".");
});
