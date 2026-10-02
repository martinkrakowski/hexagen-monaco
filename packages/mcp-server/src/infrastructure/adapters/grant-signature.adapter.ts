import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import type { Result } from "@hexagen/shared";
import {
  describeResolvedKey,
  readSliceEngagementId,
  resolveGrantKey,
  type ResolvedGrantKey,
} from "@hexagen/shared/node/grant-key";
import {
  canonicalGrantPayload,
  type Grant,
} from "../../application/kernel/grant.js";
import type { GrantSignaturePort } from "../../application/ports/out/grant-signature.port.js";

function hexToBuffer(hex: string): Buffer | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  return Buffer.from(hex, "hex");
}

export interface GrantSignatureOptions {
  /** `--key-file`. */
  readonly keyFile?: string;
  /** `--engagement`; otherwise the id in `<workspaceRoot>/.hexagen/slice.json`. */
  readonly engagementId?: string;
  /** Defaults to `process.env` (`HEXAGEN_GRANT_KEY_FILE`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test seam; defaults to `os.homedir()`. */
  readonly homeDir?: string;
}

/**
 * Verifies `grant.signature` as HMAC-SHA256 (hex) over
 * `canonicalGrantPayload(grant)`, keyed by the trusted secret that the shared
 * resolver (`@hexagen/shared/node/grant-key`, the same one `hexagen grant
 * issue` uses) finds: `--key-file`, then `HEXAGEN_GRANT_KEY_FILE`, then, in
 * repo mode (a manifest exists), `<workspaceRoot>/.hexagen/grant-signing.key`
 * exactly as before, or, in a client repo, `~/.hexagen/keys/<engagement>.key`.
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
  constructor(
    private readonly workspaceRoot: string,
    private readonly options: GrantSignatureOptions = {},
  ) {}

  /** Resolved on each call so a key minted after startup is picked up. */
  private resolveKey(): ResolvedGrantKey {
    return resolveGrantKey({
      keyFile: this.options.keyFile,
      env: this.options.env ?? process.env,
      engagementId:
        this.options.engagementId ?? readSliceEngagementId(this.workspaceRoot),
      workspaceRoot: this.workspaceRoot,
      homeDir: this.options.homeDir,
    });
  }

  /** Workspace root, key path and fingerprint for the startup log; never the key. */
  describeKey(): string {
    return describeResolvedKey(this.workspaceRoot, this.resolveKey());
  }

  async verify(grant: Grant): Promise<Result<boolean, Error>> {
    try {
      if (!grant.signature) {
        return { success: true, value: false };
      }

      const signatureBuffer = hexToBuffer(grant.signature);
      if (!signatureBuffer) {
        return { success: true, value: false };
      }

      const resolved = this.resolveKey();
      const keyPath = resolved.path;
      // A key that is present but not full strength (64 hex chars) is no
      // trust root: the issuer refuses to sign with one, so the verifier
      // must not accept one either. A missing key is handled below.
      if (keyPath === null || resolved.weakKey) {
        return { success: true, value: false };
      }
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
