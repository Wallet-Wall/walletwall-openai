# OPENAI-02 fixed-host deployment review

The starting point is the OPENAI-01 merge
`afb71af6e4bfad201da6799b97730c513d5d8ab9`. Its tree matched the reviewed
PR head `c3475eb92ce0a43cebc4001252d8f95f399580f8` byte for byte. The engine
pins in `upstream.json`, six tool handlers, output schemas, conformance
fixtures and package lock remain authoritative.

## Provider and isolation decision

**Recommend one DigitalOcean Basic Droplet with 2 vCPUs and 2 GiB RAM,
at $18/month before tax and optional backups.** Start with Ubuntu 24.04 LTS
and a verified Node.js 24 release. The plan includes 3,000 GiB of outbound
transfer per full month, and the provider offers a stateful cloud firewall
at no additional charge. At $0.01/GiB outside the team transfer pool,
handshakes, denied traffic and other traffic remain in the cost review.
A full 10,000-admission lease permits at most 39.1 GiB of admitted MCP
response bodies. Provisioned cost and the lease do not constitute a hard
monthly bill ceiling. TCP/TLS overload and denied traffic need a measured
limit and a manual shutdown procedure. The existing owner-controlled domain
can provide a subdomain subject to approval. A conventional ACME certificate
has no recurring certificate charge. No database, application subscription,
second origin or paid API is in the design.
[DigitalOcean pricing](https://www.digitalocean.com/pricing/droplets) ·
[Transfer billing](https://docs.digitalocean.com/platform/billing/bandwidth/) ·
[Cloud Firewalls](https://docs.digitalocean.com/products/networking/firewalls/details/)

| Candidate | Published monthly costs and trade-off |
| --- | --- |
| DigitalOcean Basic | $12 for 1 vCPU and 2 GiB, $18 for 2 vCPUs and 2 GiB, $24 for 2 vCPUs and 4 GiB. Shared compute can vary. Use the 2-vCPU baseline for the four-worker pilot and resize only after a host-specific capacity run. |
| Akamai Cloud (Linode) | $12 for 1 vCPU and 2 GB, or $24 for 2 vCPUs and 4 GB. A plausible fallback if the owner has existing access, billing or support there. |
| Hetzner Cloud US | The published June 2026 adjustment lists CPX11 at $20.49 and CPX21 at $37.49, both excluding primary IPv4. Confirm live order pricing and address charges. The cited US options offer no price advantage for this pilot. |

[Akamai shared CPU prices](https://www.akamai.com/cloud/pricing/cpu) ·
[Hetzner US pricing adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/#usa-ashhil)

The visible WalletWall Vercel team has one project, `walletwall`, serving
the production Vite site and its WalletWall domains on Node 24. This
inventory does not demonstrate an isolated, spare VM or a way to add an
anonymous MCP service without sharing its project or spend boundary. Use a
dedicated host unless the owner can identify an existing isolated machine
with independent credentials, firewall, cgroup limits, DNS and billing
controls. The active Vercel site continues in its existing deployment.
The earlier forwarding mode stays available for comparison and the fixed
host does not require it.

## TLS and host boundary

- A systemd socket owns dual-stack TCP 443. The unprivileged Node service
  inherits exactly one descriptor and uses native HTTPS with TLS 1.2 or
  newer, HTTP/1.1, a fixed expected Host, and one request per connection.
  Browser Origin checks stay in effect. There is no reverse proxy buffer or
  provider hop between the client and the gateway. Raw handshakes, headers,
  response writes and total request socket lifetime have absolute bounds of
  3.5 s, 3.5 s, 2 s and 12 s respectively. Node allows 32 TCP connections
  and four active HTTP exchanges. The aggregate engine deadline is 1.5 s.
- The service runs as `walletwall-mcp` with no capabilities, a read-only
  system and application tree, private temporary storage and devices, and
  its own lease directory. The unit caps CPU at 175%, memory at 768 MiB
  with a 512 MiB throttle watermark, tasks at 64 and open files at 256.
  The worker has its own V8 and stack limits and runs in the same service
  cgroup. The dedicated VM is the host-level isolation boundary.
- The unit permits socket creation only in the Unix address family and
  hides `/run`. Accepted TCP connections use the inherited listener.
  The service cannot create IPv4 or IPv6 sockets for DNS or outbound
  connections. Keep the dedicated VM free of other application workloads
  and privileged Unix sockets. Manage package updates, certificate issuance
  and administration outside the service identity. The provider firewall
  permits HTTPS and restricts administrative SSH to approved sources.
  Verify the actual systemd restrictions and IPv4/IPv6 policy on the host.
- Use an owner-approved public certificate chain and private key as one
  versioned pair. Keep the key root-owned and readable only by the
  service group. Switch the certificate directory symlink atomically and
  reload with SIGHUP. A rejected reload leaves the previous context in
  service. Reload preserves the budget and counters. ACME challenge
  handling runs outside the application. Keep any DNS or issuer credentials
  outside the service and worker environment.

[systemd service isolation](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) ·
[systemd socket activation](https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html) ·
[Node.js TLS](https://nodejs.org/docs/latest-v24.x/api/tls.html)

## Anonymous safeguards and aggregate telemetry

The original 10,000-admission lease, 12-request burst, 120/minute refill
and four concurrent executions still govern the service. The direct TLS
mode adds **300 admissions in any rolling 15 minutes** and **60 in any
rolling minute per peer bucket**, keyed by IPv4 address or IPv6 /64.
Socket peer information is authoritative. Headers such as
`X-Forwarded-For` never select a bucket. A process-local HMAC key keeps raw
addresses out of the counter map, which is capped at 1,024 entries. Each
source window expires after one minute and idle bins are swept every
minute. The longer service window contains admission times only. Source
counters and service-window refills never grant slots beyond the original
lease, and denied attempts do not consume a slot.

A widely distributed caller can still use up the public quota. The
window extends full-rate exhaustion to roughly eight hours, but a
shared ChatGPT or Codex egress can hit the per-source limit earlier.
The application returns the existing admission rejection. Measure
shared-egress traffic during the controlled pilot. Keep scheduled host
review windows available if the shared quota becomes contentious.
Lease renewal requires owner authorization and preserves the
single-use marker model. There are no reviewer reservations in this build.

The service emits aggregate admission, pressure, timeout and response
status class counters and remaining lease on SIGUSR2, at 70% and 90%
lease use, and at shutdown. Response classes count emitted headers.
A write timeout can occur afterward. Logs contain no IPs, hashed
source keys, request identifiers, headers, bodies or evidence. There
is no public metrics endpoint or analytics service. Keep access
restricted to operators and determine local journal retention before
public exposure. Disclose the provider's network processing independently.

## Artifact and pilot acceptance

```sh
npm ci --ignore-scripts
npm run verify
npm run audit:closure
npm run capacity
npm run host:package -- --out dist/walletwall-fixed-host.tar.gz
```

Build on a trusted machine with Git, curl, OpenSSL, Python and Node 24.
The deterministic host archive and SHA-512 sidecar contain only the
runtime and deployment configuration. The host does not install npm
dependencies or fetch upstream source at startup. The separate public
plugin ZIP retains its existing submission gates.

Local verification covers the inherited descriptor, hostname rejection,
TLS reload and metrics, handshake timeout, source/window recovery and
lease monotonicity. The capacity command uses the actual TLS worker and
anonymous controls over loopback. It runs 32 fixture calls in four-wide
bursts at the normal refill rate, ending with four collection-limit bundles.
It records p50/p95, peak RSS, request and response sizes, and aggregate
counts. The checks require zero incomplete results, p95 at or below
1.5 s, and RSS at or below 512 MiB.

| Local run | Complete results | p50 / p95 | Peak RSS |
| --- | --- | --- | --- |
| Workspace cgroup with 2 CPU quota | 32/32 | 636 / 1,067 ms | 340 MiB |
| Same workload restricted to one logical CPU | 32/32 | 1,072 / 1,591 ms | 369 MiB |

The largest synthetic request was 1,774,690 bytes and the largest response
was 145,961 bytes in both runs. The one-CPU run missed the 1.5-second
p95 target, which supports the $18 plan for this configuration. Local
socket handoff and reload tests passed. An extracted release also served
all six tools over an inherited HTTPS listener with a local Linux seccomp
filter that rejected fresh IPv4 and IPv6 socket creation. The unit files
passed static systemd verification using workspace paths.

Repeat the workload on the approved VM at the configured 175% CPU quota
before approving public exposure. Verify the actual systemd unit,
certificate flow, provider firewall, denied-traffic exposure, emergency
closure and aggregate transfer controls on that host.

## Owner decisions before provisioning

1. Approve the provider, region, Ubuntu image, $18/month baseline, optional
   backups, spending envelope, provider traffic controls and operator.
2. Select the exact hostname, public certificate process, administrative
   sources, recovery procedure and disclosure/retention terms.
3. Approve the host and an initial lease for a restricted pilot. Review
   anonymous bucket behavior, NAT sharing, throttling, denial costs and
   shutdown on the selected hardware before enabling public traffic.
4. Approve the installation and review plan, recording, privacy and terms
   publication and domain verification separately. Public exposure and
   OpenAI submission are later owner decisions.
