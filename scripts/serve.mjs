import { createAdmission, createForwarder, createHandler } from "../dist/handler.mjs";
import { claimGatewayLease } from "../src/gateway-lease.mjs";
import { createGatewayServer } from "../src/gateway-server.mjs";

const publicOrigin = process.env.WALLETWALL_GATEWAY_PUBLIC_ORIGIN;
const port = Number(process.env.PORT ?? 3000);
const proxy = process.argv.includes("--gateway");
const fixedHost = process.argv.includes("--fixed-host");
if (proxy && fixedHost) throw Error("Choose one gateway mode.");
const leased = proxy || fixedHost;
if (leased && (!publicOrigin || new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith("https://"))) {
  throw Error("An exact public HTTPS origin is required for gateway mode.");
}

const dispatch = proxy ? createForwarder({
  url: process.env.WALLETWALL_VERCEL_ORIGIN,
  originKey: process.env.WALLETWALL_ORIGIN_KEY,
  protectionBypass: process.env.WALLETWALL_VERCEL_BYPASS,
}) : undefined;
if (leased) claimGatewayLease(process.env.WALLETWALL_GATEWAY_LEASE_FILE);
const admit = leased ? createAdmission() : createAdmission({ burst: 64, perMinute: 600 });
const handle = createHandler({ allowedOrigins: [publicOrigin ?? "http://127.0.0.1:" + port], dispatch, admit });
const server = createGatewayServer(handle);
const disable = () => {
  server.close();
  server.closeAllConnections();
};
process.once("SIGTERM", disable);
process.once("SIGINT", disable);
server.listen(port, "127.0.0.1", () => {
  console.log("WalletWall MCP listening on loopback port " + server.address().port + ".");
});
