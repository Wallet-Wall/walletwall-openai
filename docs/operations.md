# Deployment, spend and rollback

**Status: local verification only.** A single fixed-capacity HTTPS host is
the recommendation for independent review. The protected Vercel origin is
an alternative if a separate execution environment or managed origin
rollback is needed. See the [hosting comparison](hosting-comparison.md) for
pricing, economic exposure, credentials, privacy, availability, emergency
shutdown and controls for anonymous lease exhaustion.

## Before enabling either host

1. Obtain owner approval for hosting, routing, DNS, spending, public
   exposure, privacy and terms. Record the reviewed commit, SHA-512 in
   `dist/integrity.json`, dependency notices, allowed budget and rollback target.
2. Build with Node 24 and the locked dependencies. Run one service with
   exclusive access to a private durable lease directory. Set
   `WALLETWALL_GATEWAY_LEASE_FILE` to the approved new lease path and
   `WALLETWALL_GATEWAY_PUBLIC_ORIGIN` to the exact stable HTTPS origin. Preserve
   the marker after shutdown or crash. A replacement process requires a new,
   separately authorized lease. Keep automatic restarts from creating one.
3. Put the loopback service behind TLS ingress on the same host. Strip
   untrusted forwarding headers, protect log data and enforce connection,
   header, body and downstream write limits at TLS ingress too. Configure
   bounded buffering or backpressure from the client to Node. A proxy that
   reads the full response from Node becomes responsible for its own client
   sockets, buffers and deadlines. Verify recovery with a slow public
   client before exposure.
4. Verify initialization and discovery, tool and resource calls, exact
   stdio parity, cancellation through TLS ingress, size and time limits,
   lease exhaustion, burst and shared egress behavior, egress and provider
   logs. Test the installed ChatGPT and Codex clients. See the
   [hosting comparison](hosting-comparison.md#anonymous-lease-exhaustion) for
   the proposed anonymous safeguards and the acceptance criteria.

## Single host

Start the leased local worker mode with `node scripts/serve.mjs --fixed-host`.
It uses four active exchanges, up to 32 Node connections and a single
10,000-admission lease, with the worker running on the same host. Set
service-level CPU and RSS limits, use an unprivileged service account and
verify outbound restrictions. Measure the largest legal requests, worst-case
concurrency, cold-start behavior and headroom on the selected VM size. The
plain `npm start` command is the development loopback mode.

## Separate protected origin

1. Use a dedicated Vercel project. Verify the 5-second function duration and
   cancellation on client disconnect. Verify Deployment Protection on every
   origin route and preview or production alias from an external client.
   Confirm an unauthenticated request is rejected before invoking the function.
2. Enable `WALLETWALL_ORIGIN_ENABLED=1` and set an independent randomly
   generated 32-byte hex `WALLETWALL_ORIGIN_KEY` only after verifying
   protection. Configure the gateway with `WALLETWALL_ORIGIN_KEY`,
   `WALLETWALL_VERCEL_ORIGIN` and `WALLETWALL_VERCEL_BYPASS`. Keep both
   credentials in the deployment secret store.
3. Start the leased forwarding mode with `node scripts/serve.mjs --gateway`.
   Verify the gateway can reach the origin `/api/mcp` and that no alias
   provides an alternate path to compute. Measure accepted and rejected
   traffic costs and verify provider-side economic controls before enabling
   anonymous requests.

## Emergency disable and rollback

1. Block the MCP path at ingress and send SIGTERM to the gateway. It closes
   connections and cancels in-flight requests. Verify failure from outside.
   Preserve the lease marker.
2. With a separate origin, deny the function path at the provider firewall
   or pause the dedicated project as needed. Rotate the bypass credential
   and origin key if disclosure is suspected. Check preview and production
   aliases independently.
3. With public ingress closed, restore the known-good pinned local
   artifact or origin deployment. Verify its digest, protocol and tool
   parity, cancellation and shutdown. Approve the recovery and a fresh
   lease before reopening the same public endpoint.

A single public-repository Linux CI job uses standard hosted runners and
has a ten-minute timeout. There are no deployment jobs.
[Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js) ·
[Function limits](https://vercel.com/docs/functions/limitations) ·
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
