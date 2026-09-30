import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Result } from "@hexagen/shared";
import {
  canonicalGrantPayload,
  type Grant,
} from "../../application/kernel/grant.js";
import type { GrantSignaturePort } from "../../application/ports/out/grant-signature.port.js";

const SIGNING_KEY_PATH = [".hexagen", "grant-signing.key"];

function hexToBuffer(hex: string): Buffer | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  return Buffer.from(hex, "hex");
}

/**
 * Verifies `grant.signature` as HMAC-SHA256 (hex) over
 * `canonicalGrantPayload(grant)`, keyed by the trusted secret at
 * `<workspaceRoot>/.hexagen/grant-signing.key` (a single hex-encoded
 * string; no issuer CLI mints this yet — see the PR that introduced this
 * adapter for what still has to sign a grant with it).
 *
 * Every way a signature can fail to establish trust — no signature on the
 * grant, no key file at the trust root, a key file that isn't valid hex, a
 * malformed `grant.signature`, or a signature that simply doesn't match —
 * resolves `{success: true, value: false}`, never a thrown error or a
 * `Result` failure: an unverifiable grant is an ordinary "no", and this
 * check exists specifically to fail closed on it. Only an unexpected I/O
 * error (not "file missing") while reading the key is a `Result` failure.
 */
export class GrantSignatureAdapter implements GrantSignaturePort {
  constructor(private readonly workspaceRoot: string) {}

  async verify(grant: Grant): Promise<Result<boolean, Error>> {
    try {
      if (!grant.signature) {
        return { success: true, value: false };
      }

      const signatureBuffer = hexToBuffer(grant.signature);
      if (!signatureBuffer) {
        return { success: true, value: false };
      }

      const keyPath = path.join(this.workspaceRoot, ...SIGNING_KEY_PATH);
      let keyHex: string;
      try {
        keyHex = (await fs.readFile(keyPath, "utf-8")).trim();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { success: true, value: false };
        }
        throw error;
      }
      const keyBuffer = hexToBuffer(keyHex);
      if (!keyBuffer) {
        return { success: true, value: false };
      }

      const expectedBuffer = Buffer.from(
        createHmac("sha256", keyBuffer)
          .update(canonicalGrantPayload(grant))
          .digest("hex"),
        "hex",
      );
      if (expectedBuffer.length !== signatureBuffer.length) {
        return { success: true, value: false };
      }
      return {
        success: true,
        value: timingSafeEqual(expectedBuffer, signatureBuffer),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
