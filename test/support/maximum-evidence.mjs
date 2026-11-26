import { LIMITS } from "../../.upstream/source/packages/mcp/src/schemas.ts";
import { EVALUATED_AT, golden } from "../../.upstream/source/packages/mcp/src/examples.ts";

export function maximumEvidence() {
  const seed = golden();
  const fill = (record) => {
    const copy = { ...record };
    for (let i = 0; Object.keys(copy).length < LIMITS.recordEntries; i++) {
      copy["k".repeat(30) + String(i).padStart(2, "0")] = "y".repeat(LIMITS.textLength);
    }
    return copy;
  };
  const baseObs = seed.observations[0];
  const baseClaim = seed.assertions[0];
  const longId = (prefix, i) => prefix + "0".repeat(59) + String(i).padStart(4, "0");
  const refs = Array.from({ length: LIMITS.idsPerList }, (_, i) => longId("a", i));
  const bundle = {
    ...seed,
    sources: Array.from({ length: LIMITS.sources }, (_, i) => ({
      id: longId("s", i), kind: "CHAIN_STATE", transport: { retrievedVia: "t".repeat(64) },
      authorityId: longId("s", i), independenceGroup: longId("g", i),
    })),
    observations: Array.from({ length: LIMITS.observations }, (_, i) => ({
      ...baseObs, id: longId("o", i), sourceId: longId("s", i % LIMITS.sources),
      subject: fill(baseObs.subject), payload: fill(baseObs.payload),
    })),
    assertions: Array.from({ length: LIMITS.assertions }, (_, i) => ({
      ...baseClaim, id: longId("a", i), subject: fill(baseClaim.subject), value: fill(baseClaim.value),
      observationIds: Array.from({ length: LIMITS.idsPerList }, (_, j) => longId("o", j)),
      derivationId: longId("d", i % LIMITS.derivations),
    })),
    derivations: Array.from({ length: LIMITS.derivations }, (_, i) => ({
      id: longId("d", i), ruleId: longId("r", i), rulesVersion: "v".repeat(64),
      inputAssertionIds: refs, outputAssertionId: longId("a", i),
    })),
    conflicts: Array.from({ length: LIMITS.conflicts }, (_, i) => ({
      id: longId("c", i), assertionIds: refs.slice(0, 16), reason: "VALUE_DISAGREEMENT",
    })),
    supersessions: Array.from({ length: LIMITS.supersessions }, (_, i) => ({
      id: longId("u", i), supersededAssertionId: longId("a", i), supersedingAssertionId: longId("a", i + 1),
      effectiveAt: EVALUATED_AT, reason: "CORRECTED",
    })),
  };
  return { bundle, evaluatedAt: EVALUATED_AT };
}
