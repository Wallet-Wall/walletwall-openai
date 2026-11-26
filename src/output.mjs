import { z } from "zod";
import {
  ADDRESS_RE, AssertionSchema, CHAIN_ID_RE, ClaimTypeSchema, DerivationSchema, EvaluatedAtSchema,
  FinalitySchema, FreshnessSchema, HASH_RE, ISO_RE, LIMITATION_CODES, ObservationSchema, OriginSchema,
  SupportStateSchema, TEMPORALITIES,
} from "../.upstream/source/packages/mcp/src/schemas.ts";
import { RECORD_STATUSES } from "../.upstream/source/packages/mcp/src/registry.ts";

const text = z.string();
const nullableText = text.nullable();
const texts = z.array(text);
const digest = text.regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const object = z.strictObject;
const limitations = z.array(z.enum(LIMITATION_CODES));
const date = text.regex(/^\d{4}-\d{2}-\d{2}$/);
const chainId = text.regex(CHAIN_ID_RE);
const address = text.regex(ADDRESS_RE);
const asset = object({
  symbol: text, name: text, chainId, address, decimals: text, issuerName: text, authorityId: text,
  verification: object({
    status: z.enum(RECORD_STATUSES), verifiedAt: date,
    identity: object({
      class: z.literal("AUTHORITY_ATTESTED"), authorityId: text, publisher: text,
      url: text, locator: text, publishedAddress: address, retrievedAt: date,
    }).nullable(),
    decimals: object({
      class: z.literal("CHAIN_OBSERVED"), chainId, blockNumber: text, blockHash: text.regex(HASH_RE),
      blockTimestamp: text.regex(ISO_RE), finality: z.literal("FINALIZED"),
      method: z.literal("eth_call decimals()"), observedValue: text,
    }).nullable(),
  }),
});
const diagnostics = object({
  limitation: z.enum(["INVALID_SUBJECT", "SUBJECT_MISMATCH", "INVALID_VALUE", "VALUE_MISMATCH"]),
  record: z.enum(["ASSERTION_SUBJECT", "ASSERTION_VALUE", "OBSERVATION_SUBJECT", "OBSERVATION_PAYLOAD"]),
  observationId: nullableText,
  requiredKeys: texts, missingKeys: texts, unexpectedKeys: texts, mismatchedKeys: texts,
  invalidKeys: z.array(object({ key: text, reason: z.enum(["WRONG_TYPE", "INVALID_FORMAT"]) })),
});
const assertions = object({
  assertionId: text, claimType: ClaimTypeSchema, origin: OriginSchema, temporality: z.enum(TEMPORALITIES),
  supportState: SupportStateSchema, freshnessState: FreshnessSchema, finalityState: FinalitySchema.nullable(),
  authority: object({ authorityId: text, kind: text, scope: ClaimTypeSchema, satisfied: z.boolean() }).nullable(),
  limitations, diagnostics: z.array(diagnostics), independentCorroboration: count.nullable(),
  conflictsWith: texts, supersededBy: nullableText, dependencies: object({ observationIds: texts, assertionIds: texts }),
  policyId: nullableText, digest,
});
const map = (value) => z.record(text, value);
const attributes = map(z.union([text, z.boolean(), z.null()]));
const derivation = object({ "prov:generatedEntity": text, "prov:usedEntity": text });

const outputs = new Map(Object.entries({
  resolve_asset: object({
    resolution: z.enum(["REGISTRY_MATCH", "NOT_IN_REGISTRY", "SYMBOL_CANDIDATES", "NO_SYMBOL_MATCH", "CHAIN_NOT_IN_REGISTRY"]),
    supportState: SupportStateSchema, origin: z.literal("WALLETWALL_DERIVED"),
    registry: object({ version: text, status: text }),
    asset: asset.nullable(), candidates: z.array(asset), limitations, notes: texts,
  }),
  normalize_observation: object({
    observation: ObservationSchema, canonicalJson: text, evidenceDigest: digest, contentDigest: digest, balanceDecimal: nullableText,
  }),
  inspect_evidence: object({
    wwepVersion: text, evaluatedAt: EvaluatedAtSchema, bundleDigest: digest,
    versions: object({ wwep: text, registry: text, policies: text, rules: text }),
    assertions: z.array(assertions), invariantViolationCount: count,
  }),
  check_invariants: object({
    pass: z.boolean(), violationCount: count, bundleDigest: digest,
    violations: z.array(object({ invariant: text.regex(/^INV-(?:0[0-9]|1[0-3])$/), code: text, assertionId: nullableText, rule: text })),
  }),
  trace_provenance: object({
    target: text,
    lineage: z.array(object({ id: text, kind: z.enum(["assertion", "observation"]), depth: count })),
    prov: object({
      prefix: map(text), entity: map(attributes), activity: map(attributes), agent: map(attributes),
      wasDerivedFrom: map(derivation), wasRevisionOf: map(derivation),
      wasAttributedTo: map(object({ "prov:entity": text, "prov:agent": text })),
      wasGeneratedBy: map(object({ "prov:entity": text, "prov:activity": text })),
      used: map(object({ "prov:activity": text, "prov:entity": text })),
    }),
    issues: z.array(object({ code: z.enum(["TARGET_NOT_FOUND", "DANGLING_REFERENCE", "DEPENDENCY_CYCLE"]), id: nullableText })),
  }),
  assess_vault_readiness: object({
    claimType: z.literal("VAULT_TECHNICAL_READINESS"),
    classification: z.enum(["CRITERIA_MET", "CRITERIA_NOT_MET", "NOT_ESTABLISHED"]),
    ruleId: text, rulesVersion: text,
    criteria: z.array(object({ id: text, description: text, outcome: z.enum(["MET", "NOT_MET", "INDETERMINATE"]), reason: text })),
    inputs: z.array(object({ assertionId: text, claimType: ClaimTypeSchema, supportState: SupportStateSchema, digest })),
    supportOfInputs: SupportStateSchema, limitations, doesNotEstablish: texts,
    suggestedDerivation: DerivationSchema, suggestedAssertion: AssertionSchema, resultDigest: digest,
  }),
}));

export function outputSchema(name) {
  const schema = outputs.get(name);
  if (!schema) throw Error("Missing tool output contract.");
  return z.toJSONSchema(schema, { target: "draft-2020-12", reused: "inline" });
}

export function validOutput(name, result) {
  return outputs.get(name)?.safeParse(result).success === true;
}
