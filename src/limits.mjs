export const limits = Object.freeze({
  requestBytes: 2 * 1024 * 1024,
  responseBytes: 4 * 1024 * 1024,
  bodyMs: 2000,
  evaluationMs: 1500,
  forwardMs: 4000,
  depth: 18,
  nodes: 20_100,
  capacity: 12,
  admissionsPerMinute: 120,
  admissionsPerBoot: 10_000,
  concurrent: 4,
});

export const cacheHeaders = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});
