# Reviewer guide

This is the local review package for WalletWall Vault Readiness 0.2.0. The
gateway and adapter evaluate supplied stablecoin evidence with the pinned
Copilot engine. Registry records are bundled snapshots. The classification
describes technical evidence under versioned rules.

## Six discovered tools

All tools are independent, read-only, nondestructive, idempotent and
closed-world. They read only the caller's data and bounded bundled references,
and produce no externally visible changes. These are the annotation
rationales for each tool.

| Tool | Inputs and expected result | Annotation rationale |
| --- | --- | --- |
| resolve_asset | Chain ID and address, or symbol. Returns registry status, exact match or candidates, support and limitations. | Reads a fixed registry even though identifiers refer to public contracts. It never contacts a chain. |
| normalize_observation | A supplied balance-at-block draft. Returns normalized observation, canonical JSON, exact decimal and evidence and content digests. | Computes on the supplied record without writing it or fetching a block. |
| inspect_evidence | WWEP bundle and explicit evaluation time. Returns support, freshness, finality, authority, conflicts, invariant count and digests. | Evaluates supplied evidence against bundled authority and rules. It does not interact with a source mentioned in data. |
| check_invariants | WWEP bundle and explicit evaluation time. Returns pass state, violation list and bundle digest. | Computes evidence rules without editing or repairing the bundle. |
| trace_provenance | WWEP bundle and assertion ID. Returns target, lineage, PROV-shaped graph and issues. | Traverses the supplied graph. Provenance labels and URLs are input values. |
| assess_vault_readiness | WWEP bundle, explicit evaluation time, identity and balance assertion IDs. Returns exact classification, criteria, limitations and derived result. | Applies pinned criteria to existing evidence without executing, signing or moving funds. |

The guidelines say annotation justifications are no longer required. The
submission error guide still describes them as required. Keep this table
available and confirm the current portal behavior before submitting. The
server advertises the explicit boolean annotations and published input
and output schemas. [OpenAI tool guidelines](https://developers.openai.com/plugins/plugin-guidelines#63-correct-annotation) ·
[Submission errors](https://developers.openai.com/plugins/deploy/submission-errors#final-directory-submission)

## Reproduction and actual results

Run `npm ci --ignore-scripts`, `npm run verify`, and `npm run audit:closure`.
The build regenerates `dist/fixtures/` using the bundled engine and
Copilot conformance corpus. All wallet measurements are synthetic.
`plugin/review-cases.json` contains the exact prompts and portable manifest
field inputs. These checks run the official SDK over local HTTP and compare
the engine results against the pinned stdio process.

| Case | Input and expected behavior | Local result |
| --- | --- | --- |
| P1 | USDC chain `1`, contract `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`, then symbol-only. | Exact `REGISTRY_MATCH` with `PARTIAL` support, then three `SYMBOL_CANDIDATES`. |
| P2 | `normalize-balance.json` contains two drafts with only IDs changed. | Canonical addresses and hashes, decimal `1.5`, equal content digest and different evidence digests. |
| P3 | `conflict-CNF-002.json`, with its evaluation timestamp. | Both `a-balance` and `a-balance-2` returned `CONFLICTING`. |
| P4 | `readiness-established.json`, trace `a-balance`. | Invariants pass with zero violations. `ExampleRpcProvider` survives in the trace as a transport attribute. |
| P5 | `readiness-established.json`, with its original evaluation time. | `CRITERIA_MET`. C1 through C6 all `MET`. |
| N1 | `readiness-incomplete.json` and the established fixture re-evaluated at `2027-10-23T12:00:30Z`. | Both `NOT_ESTABLISHED`. Stale case reports `STALE_EVIDENCE`. |
| N2 | Ask for a stablecoin signature and transfer. | Discovery exposes no transaction tool. A local invocation of the nonexistent `transfer` tool returns `UNKNOWN_TOOL`. Host tool selection and response remain to be verified. |
| N3 | `provenance-label.json` puts an instruction-like marker into a source transport label. | Marker stays a data value in the trace. Assessment remains `CRITERIA_MET`. Host instruction handling remains to be verified. |

Additional checks cover tool and resource discovery, output schemas, successful
engine outputs from all 115 conformance vectors, an at-cap synthetic bundle,
untrusted protocol input, cancellation, worker termination, same-ID concurrent
isolation, size limits, aggregate admission across two simulated origins,
lease reuse protection, worker environment isolation, and local shutdown.
Socket tests exercise slow response consumption, incomplete headers and bodies,
connection and writer saturation, disconnect cancellation, and recovery. A
Linux network-syscall trace of all six valid in-process tool calls recorded
zero network syscalls. Hosted request and gateway egress still require
verification on the approved infrastructure.

Upstream preflight test record: `npm run conformance:report` passed all 115 cases.
`npm run verify` from the upstream checkout recorded 3,063 passed and one
account-name hygiene failure because the workspace account name was also a
common tracked word. The targeted test in upstream's documented CI mode
recorded 25 passed with that check skipped. This adapter changes no upstream
tests or source.

The [hosting comparison](hosting-comparison.md) covers the single-host
recommendation, the optional Vercel origin and anonymous lease exhaustion.

## Recording script for the installed release

1. Open the approved build in ChatGPT and Codex, show installation or
   selection and the six discovered tools. Note the tested build and host.
2. Run P1, P2, P3 and P4. Show the point-in-time registry result, canonical
   digest behavior, unresolved conflict and source lineage.
3. Run P5 and N1. Show all six criteria and the exact established and
   missing-evidence classifications.
4. Run N2 and demonstrate the read-only boundary. Run N3 and confirm that
   the host treats the embedded label as data.
5. Verify mobile coverage for ChatGPT. Use only the synthetic fixtures,
   remove sensitive workspace details, and verify the video and fixture
   URLs from a reviewer-accessible session. Retain test transcripts scoped
   to the synthetic inputs and record the host versions and commit used.

A working-integration recording and clean installed-host results are pending.
If an approved release uses OAuth, use the portal's secure fields for the
reviewer account and instructions. [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt) ·
[Remote MCP review](https://developers.openai.com/plugins/deploy/app-review)
