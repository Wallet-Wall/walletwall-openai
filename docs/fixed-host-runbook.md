# Fixed-host activation and installed-host verification

This runbook is for the owner-approved pilot. Apply changes on the dedicated
host with ingress closed to public traffic during setup.

## Stage and verify

1. Verify the host archive SHA-512 sidecar and compiled handler digest.
   Extract the reviewed archive into a versioned, root-owned directory
   and point `/opt/walletwall/current` at it. Install a supported,
   checksum-verified Node.js 24 binary at `/opt/walletwall/node/bin/node`.
   The service user needs read and execute access to the release tree.
2. Create a dedicated `walletwall-mcp` system user and group. Install the
   service and socket units from `deploy/systemd/`, then verify them with
   `systemd-analyze verify`. Use the example to prepare
   `/etc/walletwall/gateway.env` with the approved origin and a fresh lease
   marker path under `/var/lib/walletwall-mcp/`. The environment file and
   runtime tree are owner-controlled. The service creates the empty marker.
3. Stage a valid certificate chain and private key under
   `/etc/walletwall/tls/current/`. Use a versioned directory and atomically
   replace its symlink to rotate the pair. Keep administrative credentials
   in a separate owner-controlled context. Configure the provider firewall
   to permit only approved pilot traffic to 443 and administration from
   approved sources. Verify HTTPS over both enabled address families.
4. Run the documented capacity command on the selected hardware under
   equivalent CPU and memory limits. Verify OS restrictions through the
   actual service identity and unit. Confirm the service can answer on
   its inherited socket and an equivalent service context cannot open
   fresh IPv4 or IPv6 sockets. Check that logs contain only permitted
   aggregates and that transfer and cgroup metrics support the budget.
5. After approval, use `systemctl daemon-reload` and start the
   `walletwall-mcp.socket` and `walletwall-mcp.service` units explicitly.
   Watch startup and send SIGUSR2 to the main process for the aggregate
   snapshot. The release plan does not auto-enable these units on reboot.
   If the service exits, the same lease marker prevents restarting it with
   a fresh allocation. Stop the socket as well when recovering.

Renew the certificate outside the gateway. After replacing the coherent
pair, run `systemctl reload walletwall-mcp.service` and check the fixed
reload outcome in the journal. Verify the new leaf fingerprint and confirm
that the lease count did not reset. A rejected reload leaves the previous
TLS context active.

## Emergency stop and rollback

Block 443 at the provider edge, stop `walletwall-mcp.socket`, and stop
`walletwall-mcp.service`. The socket unit must also stop because it can
activate the service. Verify that fresh connections fail and existing
connections terminate. Preserve the lease marker. Correct the cause,
switch the root-owned release link to the verified rollback artifact and
approve a new lease before reopening restricted pilot ingress. Recheck
TLS, aggregate limits, worker cancellation, logs and parity.

## Installed ChatGPT and Codex pilot

1. After HTTPS is approved for the pilot, verify issuer trust, hostname,
   TLS version, MCP Inspector initialization and protocol negotiation.
   Discover the six tools, validated schemas, annotations and available
   resource operations. Check request and response bounds, unavailable
   resources, timeouts, cancellation, and limited or exhausted admission.
2. Connect the endpoint using the supported development workflow and test
   the portable plugin in approved ChatGPT and Codex test contexts.
   Verify the accessible resources or bundled references, exact tool
   selection, fallback behavior when the tools are unavailable, and
   P1–P5 and N1–N3 using the pinned synthetic fixtures. Include ChatGPT
   mobile coverage where applicable and repeat with measured shared
   network egress. Record build and client versions and which surface
   each result came from.
3. Record the demonstration on a working approved integration, review it
   for sensitive material and verify the fixture and video links. Confirm
   the selected OpenAI verification host can serve the exact portal
   challenge. The MCP runtime serves only `/mcp`, so handle a required
   challenge through an approved eligible domain or temporary controlled
   verification path outside this runtime. Domain and portal changes
   remain owner-controlled.

[Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt) ·
[Domain verification and submission](https://developers.openai.com/plugins/deploy/submission)
