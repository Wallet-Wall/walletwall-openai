# OpenAI requirements-to-evidence matrix

Reviewed against official OpenAI material on November 25, 2026. Status is
scoped to the evidence described in each row.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Repository and one implementation lane | Pass | Public adapter repository, protected main verified through branch metadata, and one implementation branch. Copilot and Claude remain separate and the private plugin is preserved. |
| Pinned source, redistributable artifacts and intellectual property | Pass locally | Exact engine, source, skill and icon pins are in [upstream.json](../upstream.json). Apache-2.0 and applicable notices are included. Owner approved the existing branding. Runtime dependency notices are generated with the build. |
| Supported public transport | Pass locally, blocked operationally | Official SDK Streamable HTTP over loopback. The stable public HTTPS host and final topology are owner-gated. [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server) |
| Six independently callable, read-only tools and metadata | Pass locally | SDK discovery has six explicit tool schemas and accurate annotations. Results are validated without transformation and match the stdio baseline. The reviewer guide contains the annotation rationales. [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines) |
| Origin security, resource and economic protections | Pass locally, blocked operationally | Worker termination, bounded socket and write lifetimes, aggregate lease, and local fixed-host and forwarding checks pass. Confirm ingress timeouts, capacity, economic exposure and actual shutdown on the selected topology. [Hosting comparison](hosting-comparison.md) [Security and privacy](https://developers.openai.com/plugins/guides/security-privacy) |
| Cloud privacy, support and terms | Blocked on publication | Draft cloud policies are in this repository. Publisher and contact, public URLs, provider settings, retention and disclosure require verification and owner approval. [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines) |
| Portable package, skill and branding | Pass locally, final ZIP blocked | Root Portable Agent Plugins schema, deterministic inventory and digest path, approved PNG and skill references validated locally. The package generator requires real release URLs and verified publisher data for a public ZIP. [Packaging](https://developers.openai.com/plugins/build/plugins) |
| Title, category, listing, onboarding and commerce | Pass for draft | WalletWall Vault Readiness, Verify stablecoin evidence, Developer Tools, three starter prompts, global intent and no commerce. Owner confirmation is required for verified portal identity and final allowed countries. [Submission metadata](https://developers.openai.com/plugins/deploy/submission) |
| Exact review fields and cases | Pass locally | Five positive and three negative cases are packaged from one case file with reproducible inputs. Presenter and installed host runs are pending. [Review fields](https://developers.openai.com/plugins/deploy/submission#configure-onboarding-review-and-publication) |
| Demo, production verification, portal scans | Blocked | Recording, real approved endpoint, real URLs, domain challenge, target runtime install, metadata and skill scans, tool scan and applicable review checks remain outstanding. [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt) · [Remote MCP review](https://developers.openai.com/plugins/deploy/app-review) |
| Annotation justifications | Blocked in portal | The guidelines and submission-error reference differ. Explicit values are emitted, and reviewer documentation holds the rationale for each tool. Confirm the required portal fields during live scan. [Submission errors](https://developers.openai.com/plugins/deploy/submission-errors) |
| Stdio approval, OAuth credentials and interactive UI | Not applicable to initial design | One anonymous remote server, conditional on the exposure gate, and structured responses without UI. The desktop-only path needs separate approval. If OAuth becomes needed, use OAuth 2.1 authorization code with PKCE and protected resource and issuer metadata, scoped and audience-validated access tokens, and portal-only reviewer credentials. [Authentication](https://developers.openai.com/plugins/build/auth) · [Desktop-only submissions](https://developers.openai.com/plugins/deploy/desktop-only) |
| Complete upstream verification in preflight workspace | Fail | The strict account-name hygiene test reported one documented environmental failure. Conformance passed. No upstream check was weakened. |

## Package commands

```sh
npm run build
npm run package -- --check
```

The check validates both official Agent Plugins JSON Schemas, OpenAI case
counts and fields, listing lengths, icon integrity, archive paths, CRC,
secret-shaped content and byte determinism. Its test archive stays in
memory. The independent test package and archival report are not a live
portal validation.

After owner approval and verification, create a release configuration JSON
with exactly these keys:

- `mcp_url` for the working stable HTTPS `/mcp` endpoint
- `demo_url` for the real reviewer-accessible recording
- `fixtures_url` for the reviewed HTTPS directory serving the generated fixtures
- `developer_name` for the verified publisher display name
- `websiteURL`, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL`

Use the following command with the approved config. The build writes the ZIP
and SHA-512 sidecar. Keep the existing private plugin package separate.

```sh
npm run package -- --release-config /path/to/approved-release.json --out dist/walletwall-openai-0.2.0.zip
```

## Owner-controlled portal checklist

1. Approve infrastructure, DNS, spend, network protection, runtime metrics
   and retention. Confirm the four listing URLs and publish the approved
   cloud privacy and terms through the normal owner process.
2. Verify the intended publisher identity on a globally resident OpenAI
   project with Apps Management Write. Confirm supported countries and the
   no-commerce declaration. Approve the recorded demo and the final archive.
3. In the Plugins portal, use **With MCP**. Complete **Metadata & Skills**
   checks, then connect the remote server and satisfy the domain challenge
   at the portal-specified `/.well-known/openai-apps-challenge` path. Confirm
   all six discovered descriptors and the exact saved review details.
4. Validate the installed ChatGPT and Codex review cases, metadata and skill
   scans, current tool scan, recording and fixture access, and applicable
   reviewer access. Complete legal attestations before authorizing
   submission. Publication is a separate step after approval.

[Submission lifecycle](https://developers.openai.com/plugins/deploy/submission) ·
[Remote review](https://developers.openai.com/plugins/deploy/app-review)
