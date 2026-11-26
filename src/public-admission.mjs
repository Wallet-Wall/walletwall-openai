import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { createAdmission } from "./admission.mjs";

export const publicLimits = Object.freeze({
  windowMs: 15 * 60_000,
  windowAdmissions: 300,
  sourceMs: 60_000,
  sourceAdmissions: 60,
  sources: 1024,
});

function sourcePrefix(address) {
  const family = isIP(address ?? "");
  if (family === 4) return address;
  if (family !== 6 || address.includes("%")) return undefined;

  const canonical = new URL("http://[" + address + "]/").hostname.slice(1, -1);
  const [head, tail] = canonical.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.slice(0, 5).every((group) => group === "0") && groups[5] === "ffff") {
    const high = Number.parseInt(groups[6], 16);
    const low = Number.parseInt(groups[7], 16);
    return [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
  }
  return groups.slice(0, 4).join(":");
}

function expire(timestamps, cutoff) {
  while (timestamps.length && timestamps[0] <= cutoff) timestamps.shift();
}

/** The public limits can refuse work, but only the existing aggregate admission can grant a slot. */
export function createPublicAdmission({
  admit = createAdmission(),
  clock = () => performance.now(),
  record = () => {},
} = {}) {
  const salt = randomBytes(32);
  const recent = [];
  const sources = new Map();
  function sweep() {
    const now = clock();
    expire(recent, now - publicLimits.windowMs);
    for (const [key, timestamps] of sources) {
      if (timestamps.at(-1) <= now - publicLimits.sourceMs) sources.delete(key);
    }
  }
  setInterval(sweep, publicLimits.sourceMs).unref();

  return (peer) => {
    const prefix = sourcePrefix(peer);
    if (prefix === undefined) {
      record("invalid_peer");
      return;
    }

    const now = clock();
    expire(recent, now - publicLimits.windowMs);
    if (recent.length >= publicLimits.windowAdmissions) {
      record("window_limited");
      return;
    }

    const key = createHmac("sha256", salt).update(prefix).digest("hex");
    const existing = sources.get(key);
    if (!existing && sources.size >= publicLimits.sources) {
      record("source_capacity");
      return;
    }
    const timestamps = existing ?? [];
    expire(timestamps, now - publicLimits.sourceMs);
    if (timestamps.length >= publicLimits.sourceAdmissions) {
      record("source_limited");
      return;
    }

    const release = admit();
    if (!release) {
      record("aggregate_limited");
      return;
    }
    recent.push(now);
    timestamps.push(now);
    if (!existing) sources.set(key, timestamps);
    record("admitted");
    return release;
  };
}
