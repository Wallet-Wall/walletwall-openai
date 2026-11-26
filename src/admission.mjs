import { limits } from "./limits.mjs";

/**
 * Use once at the ingress for the whole service, before routing to any origin.
 * It keeps only counts, and a single owner-scoped lease bounds admitted requests for the process lifetime.
 */
export function createAdmission({
  burst = limits.capacity,
  perMinute = limits.admissionsPerMinute,
  perBoot = limits.admissionsPerBoot,
  concurrent = limits.concurrent,
  clock = () => performance.now(),
} = {}) {
  for (const value of [burst, perMinute, perBoot, concurrent]) {
    if (!Number.isSafeInteger(value) || value < 1) throw Error("Invalid admission capacity.");
  }
  let tokens = burst;
  let updated = clock();
  let active = 0;
  let remaining = perBoot;
  return () => {
    const now = Math.max(updated, clock());
    tokens = Math.min(burst, tokens + (now - updated) * perMinute / 60_000);
    updated = now;
    if (remaining <= 0 || tokens < 1 || active >= concurrent) return undefined;
    remaining--;
    tokens--;
    active++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      active--;
    };
  };
}
