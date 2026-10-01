import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SIGNING_KEY_RELATIVE_PATH = [".hexagen", "grant-signing.key"];

export interface LoadedSigningKey {
  readonly keyHex: string;
  readonly created: boolean;
  readonly path: string;
}

/**
 * Reads the trust root `GrantSignatureAdapter.verify` checks against
 * (`<workspaceRoot>/.hexagen/grant-signing.key`). If it doesn't exist yet,
 * mints a fresh 32-byte random key and writes it — per
 * `docs/kernel/GRANT.md` "No issuer exists yet": "create it ... if it
 * doesn't exist; treat it like any other credential, never commit it." The
 * caller is told whether a key was just created, so it can warn loudly
 * (this is a secret landing on disk in a git working tree).
 */
export async function loadOrCreateSigningKey(
  workspaceRoot: string,
): Promise<LoadedSigningKey> {
  const keyPath = path.join(workspaceRoot, ...SIGNING_KEY_RELATIVE_PATH);
  try {
    const keyHex = (await readFile(keyPath, "utf-8")).trim();
    if (!/^[0-9a-f]+$/i.test(keyHex) || keyHex.length === 0) {
      throw new Error(
        `Signing key at ${keyPath} is not valid hex — refusing to sign with it.`,
      );
    }
    return { keyHex, created: false, path: keyPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const keyHex = randomBytes(32).toString("hex");
  await mkdir(path.dirname(keyPath), { recursive: true });
  await writeFile(keyPath, `${keyHex}\n`, { mode: 0o600 });
  return { keyHex, created: true, path: keyPath };
}
