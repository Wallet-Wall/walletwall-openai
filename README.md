# WalletWall OpenAI

Stablecoin evidence and vault technical readiness for ChatGPT and Codex.

Status: pre-release; no hosted service or public directory listing is available from this repository yet.

This repository is the OpenAI distribution and transport adapter. The authoritative read-only MCP evidence engine, policies, registry, and conformance corpus are maintained in [walletwall-copilot](https://github.com/Wallet-Wall/walletwall-copilot). [walletwall-claude](https://github.com/Wallet-Wall/walletwall-claude) is the Anthropic distribution adapter.

WalletWall evaluates supplied evidence and bundled point-in-time reference data. It does not sign, custody, trade, broadcast transactions, offer investment advice, or guarantee security or quantum resistance.

Initial development is governed by OPENAI-01. Production provisioning, public endpoint exposure, spending commitments, policy publication, and directory submission require separate owner approval. Implementation changes must be reviewed through a draft pull request; no automatic merge.

The intended license is Apache-2.0; applicable upstream notices must accompany redistributed material.

## Local verification

Requirements are Node.js 24 recommended (22.18 or later), Git, curl and Python 3.
Run from the repository root:

```sh
npm ci --ignore-scripts
npm run verify
npm run audit:closure
npm start
```

The build fetches an exact Copilot commit and verifies the engine, skill and icon
before extracting source. To use an existing checkout containing the pin, set
`WALLETWALL_COPILOT_DIR` to that checkout. The build reads Git objects at the pin.
It writes the isolated HTTP handler, fixture files, integrity inventory and
dependency notices to `dist/`. The finished handler contains no runtime source
download, evidence provider or database connection.

`npm start` listens on `127.0.0.1:3000/mcp`. Use the MCP Inspector or another
Streamable HTTP client. The six tool calls accept supplied evidence. Registry
matches are point-in-time references.

- [Architecture and threat model](docs/security.md)
- [Hosting comparison and anonymous lease controls](docs/hosting-comparison.md)
- [Deployment, spend and rollback runbook](docs/operations.md)
- [Reviewer guide and verification results](docs/reviewer.md)
- [OpenAI requirements matrix](docs/submission.md)
- [Draft cloud privacy notice](docs/privacy.md) and [draft terms](docs/terms.md)

For OPENAI-02 see the [fixed-host deployment review](docs/fixed-host.md) and
[activation and installed-host runbook](docs/fixed-host-runbook.md).
