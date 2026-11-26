# Remote MCP architecture and threat model

The Copilot commit in [upstream.json](../upstream.json) owns the evidence contracts,
tool handlers, policy, registry, canonicalization and reference resources.
The adapter publishes the same input schema and result for each successful call.
It validates the output against a strict JSON Schema contract derived from the
pinned result types and existing upstream validators. The result is returned
as produced by the engine. Input, tool and internal errors fail closed.

## Request and data flow

```text
ChatGPT or Codex
    -> public HTTPS gateway (one authorized aggregate budget lease)
        -> protected Vercel origin (first-party transport hop)
            -> short-lived Node worker with static SDK and Copilot source
        <- bounded JSON MCP response
    <- tool result
```

Local verification runs the same worker and handler on loopback. The gateway
binds to loopback behind an owner-approved TLS ingress. The Vercel function is
disabled by default and requires an origin credential on every request. The
gateway sends only selected protocol headers, its first-party origin credentials
and the bounded request body. The deployment protection bypass and application
origin key belong in deployment secrets, never the plugin manifest or review
fixtures. The worker receives only the body and selected protocol headers.
The Vercel origin response marker lets the gateway discard provider error
pages and pass only adapter-owned MCP responses. These deployment assumptions
require end-to-end validation before exposure.

### Controls and evidence

| Threat | Control and verification |
| --- | --- |
| Untrusted protocol and schemas | Only POST to the configured path, approved Origin when present, JSON media type, supported encoding, and both required Accept media types. The official MCP SDK handles lifecycle and JSON-RPC. One message per request. Named tools and resources use static dispatch. Protocol errors have fixed text. |
| Oversized bodies and results | Declared and streamed request cap of 2 MiB and a 2-second body deadline. Decoded envelope cap of 18 levels and 20,100 nodes. Upstream argument caps remain in force. The worker checks the encoded response against 4 MiB before returning it. Limits fail with an explicit error and no partial result. |
| CPU, memory and concurrent requests | One worker per admitted operation, 1.5-second wall-clock execution deadline, resource limits for the V8 heap and stack, and termination on completion, deadline, or caller disconnect. The tests stop a worker in a synchronous loop. Gateway capacity is four admitted requests and 32 local connections. Worker startup, cold processes and provider overhead need hosted measurement. |
| Aggregate abuse, replay, and spend | The single gateway limits all accepted calls before origin routing. It uses a token bucket with burst 12 and 120 admissions per minute, four concurrent requests and a lifetime ceiling of 10,000 admissions. A one-time empty filesystem marker prevents restarting the same authorized budget lease. It contains no request data. Repeated and replayed calls use the same lease. Origin authentication prevents direct use of the application. Confirm provider-level protection before invocation on all origins and aliases. |
| Request isolation | A fresh stateless MCP transport and worker per request. No session store, database, request cache or persistent user data. The parallel tests use identical RPC IDs with distinct inputs and check response isolation. |
| Instruction-like evidence | The skill and server instruct hosts to treat fields as data. The engine validates and evaluates the bounded records, uses supplied strings as values, and makes no provider calls. Locally, the synthetic injected label remains lineage data and does not move the readiness result. Host interpretation is a separate review check. |
| Prototype pollution, SSRF, and path traversal | The protocol guard rejects unsafe object keys. The engine validates the input with existing schemas. Resource reads use an exact lookup table. Caller strings never select network destinations or filesystem paths. The gateway forwards only to its configured HTTPS Vercel origin and rejects redirects. |
| Build and dependency integrity | Exact Git, bundle, skill and icon pins and a locked npm install. The build emits an input and external-import inventory and refuses an unexpected package or external import. The isolated worker has only SDK, Zod, Zod-to-JSON-Schema and content-type code. Unused SDK elicitation validation is replaced by a fail-closed build stub. |
| Logging and error disclosure | The adapter has no per-request logger. Worker stdout and stderr are discarded. The loopback process emits only its startup status. Errors contain fixed status information or sanitized engine diagnostics. The gateway does not return provider log or error bodies. Provider logs must be verified separately. |
| Denial of service and shutdown | Fixed local gateway connection count, application rate and concurrency, origin response cap, function deadline, one-time lease and immediate local SIGTERM shutdown. Provider DDoS protection, residual rejected-traffic cost, production cancel behavior and observed recovery are hosting acceptance criteria. |

## Dependency advisory decision

Preflight found moderate advisories in Copilot's installed dependency tree for
`hono@4.13.13` and `@hono/node-server@2.1.5`. This adapter lock resolves
`hono@4.13.22` and `@hono/node-server@2.1.11`. Neither is in the emitted
application closure. The source of the emitted HTTP transport is the SDK's
Web Standard Streamable HTTP implementation and its small content-type
parser. The build and test fail if Hono or another unapproved package enters
that closure. `npm run audit:closure` evaluates current registry advisories
against the actual emitted package inventory and fails on reachable
moderate or higher findings. The package lock remains necessary for the
builder and development tools.

## Remaining security decisions

The process-wide limits assume one fixed-capacity gateway with exclusive access
to its lease directory. An independently mounted duplicate gateway would
create independent capacity. Deployment review must verify that configuration
and provider-side direct-origin protection. Node resource limits control V8
memory, with additional bounded buffers accounted for separately. The runtime
still relies on host isolation and TLS ingress for platform-level resource
and network controls. Production provider processing, retention and error
reporting must be verified before publishing the cloud privacy notice.

[MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) ·
[OpenAI security and privacy](https://developers.openai.com/plugins/guides/security-privacy) ·
[Copilot dependency policy](https://github.com/Wallet-Wall/walletwall-copilot/blob/0e372193e2e595815535ef28ab39482591c767f6/docs/DEPENDENCY_POLICY.md)
