# Deployment, spend and rollback

**Status: local verification only.** Review and approve hosting, spend,
routing, DNS, privacy and terms separately. Maintain a dedicated Vercel project
for the protected origin. The public endpoint is the gateway's stable HTTPS
`/mcp` path. The separate gateway requires a single fixed-capacity service
or machine approved by the owner. A serverless replica-local quota cannot
establish the service-wide limit.

## Before enabling a host

1. Record the reviewed commit, SHA-512 in `dist/integrity.json`, dependency
   notices, allowed request budget, rollback target and owner approval.
2. Build with Node 24 and the locked dependencies. Confirm the Vercel
   build produces the pinned handler and the function operates with the
   configured 5-second max duration and request cancellation.
3. Verify that Deployment Protection covers the origin including publicly
   reachable generated deployment aliases. Use a gateway-only bypass
   credential and an independent randomly generated 32-byte hex origin key.
   Test unauthenticated access to every origin route and alias from outside
   the team. If a production alias is public or bills origin work before
   rejection, leave anonymous exposure disabled pending a secure plan and
   cost decision.
4. Set `WALLETWALL_ORIGIN_ENABLED=1` and `WALLETWALL_ORIGIN_KEY` inside the
   reviewed origin environment only after the protected configuration is
   ready. Confirm that the trusted gateway can call `/api/mcp`. The gateway
   uses `WALLETWALL_VERCEL_ORIGIN`, `WALLETWALL_VERCEL_BYPASS`,
   `WALLETWALL_ORIGIN_KEY`, and `WALLETWALL_GATEWAY_PUBLIC_ORIGIN`.
5. Launch one `node scripts/serve.mjs --gateway` behind the approved TLS
   ingress. Set `WALLETWALL_GATEWAY_LEASE_FILE` to the new owner-approved
   lease path in the gateway's private durable state directory. Preserve the
   marker on shutdown or crash. A restarted or replacement process may only
   start after the owner authorizes a new lease. Configure the supervisor to
   avoid automatic restart with a new lease.
6. Test initialization and discovery, every tool and resource path, exact
   parity, protocol versions, upstream cancellation on client disconnect,
   isolation, overload, approved clients behind shared network egress,
   unexpected network egress, and the provider log fields and retention.
   Run the installed client cases on ChatGPT and Codex. Only after these
   results and the cost envelope are reviewed can anonymous exposure be
   approved.

## Cost model

Function pricing uses `iad1` rates, 2 GB memory, and no concurrency savings.
Illustrative gross Vercel costs before credits, gateway hosting, taxes and
other usage were about $0.15 at 20,000 typical requests, $1.46 at 200,000,
and $447.58 at 10 million abusive requests with the preflight traffic
profiles. The shipped gateway instead admits at most 10,000 requests per
owner-authorized lease. At 5 seconds of CPU and memory per admission and
6 MiB bidirectional transfer per admission, a conservative count-based
estimate of admitted Vercel traffic is about **$15.32 per full lease**. This
includes $0.128 per CPU-hour, $0.0106 per GB-hour, $0.60 per million
invocations, $2.50 per million CDN and allowed WAF requests, and $0.21 per
GB summed edge and origin transfer. Typical model assumptions were 15 ms
active CPU, 50 ms instance time, and 16 KB transfer.

A lease excludes denied ingress, direct-origin edge traffic, repeated lease
grants, fixed gateway and TLS costs, preview usage, seats and storage. These
costs depend on the provider and must be bounded or approved separately.
A product or project budget and automatic pause are additional controls.
Vercel budget checks are delayed and previews may keep serving after a
production pause. Until alias protection, fixed capacity and the provider
billing envelope are tested, the overall cost ceiling is unverified.
There are no blockchain-provider, model API or database charges in this design.

One Linux CI job is expected to take under ten minutes. At $0.006 per minute
beyond included usage, that is at most $0.06 per run on a paid private
runner profile. Standard runners for public repositories are currently free.
CI includes no deployment workflow.

## Emergency disable and rollback

1. Block the public MCP path at the approved ingress and send SIGTERM to
   the single gateway. The gateway stops accepting connections and aborts
   in-flight requests. Verify failure from outside the gateway and check
   direct origin aliases. Local SIGTERM and the disabled-origin gate are
   covered by tests.
2. Deny the origin path at the provider firewall or pause the dedicated
   project if necessary. Rotate both gateway credentials if disclosure is
   suspected. Confirm that preview aliases remain inaccessible.
3. Select the known-good origin deployment at the same approved endpoint
   and verify its pinned digest. Keep public ingress closed during parity
   and abuse checks. Roll back gateway code and configuration as needed.
4. Resume only with owner authorization and a fresh aggregate lease. Verify
   initialization, tools, a synthetic assessment, budget and alias protection
   before serving public traffic.

[Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js) ·
[Function limits](https://vercel.com/docs/functions/limitations) ·
[Vercel regional pricing](https://vercel.com/docs/pricing/regional-pricing/iad1) ·
[Spend management](https://vercel.com/docs/spend-management#pausing-projects) ·
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
