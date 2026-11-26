import { closeSync, constants, openSync } from "node:fs";
import { isAbsolute } from "node:path";

/** Reserve an owner-authorized budget for one gateway process, even across restarts. */
export function claimGatewayLease(path) {
  if (typeof path !== "string" || !isAbsolute(path)) throw Error("An absolute gateway lease path is required.");
  let fd;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  } catch {
    throw Error("Gateway lease unavailable or already used.");
  }
  closeSync(fd);
}
