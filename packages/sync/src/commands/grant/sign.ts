import { createHmac } from "node:crypto";

/** HMAC-SHA256 (hex) over `payload`, keyed by `keyHex` (also hex). */
export function signGrantPayload(payload: string, keyHex: string): string {
  return createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(payload)
    .digest("hex");
}
