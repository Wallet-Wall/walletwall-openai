# Hosting comparison

**Recommendation for independent review.** Start with one fixed-capacity
HTTPS host. Run TLS ingress, admission control, and the existing isolated
worker on that host. This keeps a single public entry point and the same
aggregate lease. There is no hosted blockchain provider, database, or
outbound data lookup. The separate Vercel origin offers a separate execution
environment and managed deployment rollbacks. Those benefits do not justify a
second service for the initial rollout unless measured capacity or a reviewed
isolation requirement calls for it. Both modes remain available for review.

| Dimension | Single fixed-capacity HTTPS host | Fixed gateway and protected Vercel origin |
| --- | --- | --- |
| Fixed hosting cost | Illustrative DigitalOcean Basic VM costs $12/month for 1 vCPU, 2 GiB RAM and 2,000 GiB outbound transfer. A 2 vCPU, 4 GiB option costs $24/month if capacity testing calls for it. TLS, DNS, backup, monitoring, taxes and operator time are separate. The VM sizes are pricing examples. | The gateway still needs a host. Using the same $12 comparison VM and a new Vercel Pro team gives $32/month in fixed platform cost before credits, metered usage and optional services. An existing Pro team may have zero incremental platform fee, subject to its actual agreement and shared credit. Vercel announced that all-deployment Vercel Authentication is available without a separate fee. Verify entitlement and bypass behavior for the actual project. |
| Aggregate economic exposure | CPU and memory are limited by the machine and service configuration. A full 10,000-request lease at the 4 MiB response cap yields at most 39.1 GiB of admitted MCP response bodies before protocol overhead. Metered outbound traffic also includes TLS, rejections and other traffic. The cited VM includes pooled transfer and charges $0.01/GiB beyond that allowance. A hard bill ceiling requires an independently verified provider or ingress traffic cap. | The same gateway lease bounds accepted work and adds up to 19.5 GiB of request bodies sent to Vercel. As a comparison, pricing 10,000 origin requests at 5 seconds of active CPU, 2 GB of memory held for 5 seconds, and 6 MiB transfer each gives about $15.32 in gross Vercel metered usage before allowances or credits. Direct-origin edge traffic, previews, rejected traffic, deployment storage and additional leases sit outside this estimate. Check all aliases and measure bypass denials externally. |
| Credentials | TLS material and host administration credentials. Anonymous MCP requires no user accounts or application secrets. | The gateway additionally needs the project-level Vercel Automation Bypass secret and an independent application origin key. Secure both, rotate separately, and verify that all aliases require protection before reaching the function. |
| Privacy | WalletWall evidence transits the client host and one approved service host. TLS ingress and VM-provider metadata and retention still need review. | The full selected request body and result also transit Vercel. Provider access, retention, tracing, region and metadata must be verified at both tiers. Neither design calls evidence providers or keeps a request history. |
| Availability and isolation | One host is a failure and capacity domain. The worker bounds execution and V8 memory inside Node. Host limits must cover RSS, CPU and outbound network access, and the service should run unprivileged. | Separates worker execution from the gateway host and adds managed origin rollout and rollback. Vercel can scale compute, but the single gateway and its lease still govern public service availability. Origin failures, network latency and credential rotation add failure modes. |
| Emergency shutdown | Block the MCP path at TLS ingress and stop the one service. Verify from outside and leave the lease marker intact. For rollback, select a local artifact by digest while ingress is closed. | Block and stop the gateway too. Separately verify or block Vercel routes and aliases, disable the origin or revoke its credentials if necessary. Vercel's spend pause is delayed and existing previews can stay active. |

The $15.32 example uses Vercel's published `iad1` list rates at
$0.128/CPU-hour, $0.0106/GB-hour, $0.60/million function invocations,
$2.50/million combined CDN and allowed WAF requests, and $0.21/GB for
the two modeled transfer rates. The model assumes no concurrency savings
and applies both transfer rates to all modeled bytes. It is an illustrative
upper-end calculation for admitted traffic under those assumptions. A
Vercel Pro team has a $20 monthly usage credit, which may already be
allocated to other workloads.

[DigitalOcean VM pricing](https://www.digitalocean.com/pricing/droplets) ·
[DigitalOcean transfer billing](https://docs.digitalocean.com/platform/billing/bandwidth/) ·
[Vercel regional rates](https://vercel.com/docs/pricing/regional-pricing/iad1) ·
[Vercel Functions pricing](https://vercel.com/docs/functions/usage-and-pricing) ·
[Vercel Pro](https://vercel.com/docs/plans/pro-plan) ·
[Vercel production protection](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan) ·
[Automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) ·
[Vercel spend pauses](https://vercel.com/docs/spend-management#pausing-projects)

## Anonymous lease exhaustion

The lifetime 10,000-admission cap bounds accepted work and deliberately fails
closed. At 120 admissions per minute with a full initial burst of 12, the
shared allocation can run out in about **83 minutes** if the service remains
at the rate limit. The lease counts admitted protocol requests, including
discovery and requests that are abandoned after admission. Once exhausted,
ordinary callers and reviewers are refused until the owner grants a fresh
lease. A server restart with the same lease marker preserves that outage.
Rate limiting and bounded socket lifetimes protect capacity while a lease
has room. Neither selects which anonymous requests are legitimate.

Before anonymous exposure, approve and test these incremental controls:

1. Use an ingress per-source burst and rate limit with short-lived bounded
   counters and no persisted IP or evidence logs. Derive source identity from
   the trusted TLS ingress or provider, with client-supplied forwarding
   headers stripped. Test shared ChatGPT and Codex egress and avoid strict
   per-IP limits that cut off ordinary shared usage.
2. Add an anonymous per-window allowance within the owner-granted total, and
   monitor aggregate admissions, rejections and remaining lease at warning
   and critical thresholds. Window refill must stay within the lifetime
   allowance. Renew leases manually after reviewing usage and the spend
   envelope. This spreads demand and gives operators time to act.
3. If reviewer access needs a reserve, give it a small slice of the same
   lifetime budget, gated by a verified platform or owner-controlled access
   mechanism proven compatible with the intended clients. User-Agent and
   caller-supplied headers are insufficient to identify that traffic. If
   verification is unavailable, schedule an owner-controlled review window.
   Revisit account or OAuth collection only if measured abuse defeats these
   lighter controls.

Distributed sources and shared egress can still cause availability loss.
These are rollout proposals. The current implementation enforces the global
lease and socket limits and has no per-client tracking or reserved quota.
