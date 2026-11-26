# Draft cloud privacy notice

For owner review. Before publication, supply the verified publisher and
privacy request contact, actual host regions, provider settings and
retention, and any additional legal disclosures required for distribution.

When you use WalletWall Vault Readiness through ChatGPT or Codex, the host
sends the selected tool inputs to the WalletWall service. Inputs can include
pseudonymous wallet and contract addresses, chain and block identifiers,
dates, balances, source labels, and provenance. Include only evidence
necessary for the request. Do not send private keys, seed phrases, signatures,
provider credentials, or personal identifiers. The service evaluates the
evidence you supply and returns the result to the requesting host. It uses a
bundled point-in-time registry and policies.

WalletWall's proposed application processes inputs in memory for the request
and releases them after processing. It adds no database, request-history
store, analytics, or evidence log. It uses aggregate capacity counters and an
empty operating lease marker with no user or request information. Its
operations do not identify people behind wallet addresses.

The service providers for TLS ingress and compute may process network
metadata, timestamps, request status, routing and security information to
provide and protect the service. Recipients, retention, access restrictions
and regions depend on the approved infrastructure. Verify and disclose them
before publication. Vercel's published runtime log retention varies by plan,
including one day for standard Pro and 30 days with Observability Plus.
Restrict provider log access to authorized operators and exclude payload
collection or logging where the provider supports that configuration.

ChatGPT and Codex process conversations and tool activity under OpenAI's
terms and user settings. Their data controls and retention are separate
from WalletWall's service. Users can disconnect the plugin and choose which
evidence to provide. The approved privacy contact must handle applicable
access, correction and deletion requests concerning WalletWall-controlled
information. If support uses a public issue tracker, share only synthetic
examples there.

[OpenAI privacy policy](https://openai.com/policies/privacy-policy/) ·
[Vercel runtime logs](https://vercel.com/docs/logs/runtime)
