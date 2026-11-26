import { createOriginHandler } from "../dist/handler.mjs";


const fetch = createOriginHandler({
  enabled: process.env.WALLETWALL_ORIGIN_ENABLED === "1",
  originKey: process.env.WALLETWALL_ORIGIN_KEY,
});

export default { fetch };
