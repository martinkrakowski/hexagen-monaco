import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const SIGNING_KEY_RELATIVE_PATH = [".hexagen", "grant-signing.key"];

// 32 bytes, hex-encoded — matches the key `randomBytes(32)` mints below.
// `GrantSignatureAdapter.verify` accepts any even-length hex string (it has
// no minimum), so a short existing key (e.g. "00") would sign and verify
// but makes the HMAC guessable; the issuer is the one place that can refuse
// to use a weak trust root in the first place.
const REQUIRED_KEY_HEX_LENGTH = 64;

export interface LoadedSigningKey {
  readonly keyHex: string;
  readonly created: boolean;
  readonly path: string;
}

const GITIGNORE_ENTRY = ".hexagen/grant-signing.key";

/**
 * A routine `git add -A` after `hexagen grant issue` would stage the
 * signing key unless the workspace's `.gitignore` already covers it —
 * anyone who then obtains the committed key could forge accepted grants. We
 * can't assume a consumer repo already ignores `.hexagen/`, so the issuer
 * appends the one line it needs itself, idempotently, before minting a key.
 */
async function ensureKeyIsGitignored(workspaceRoot: string): Promise<void> {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const alreadyCovered = existing
    .split("\n")
    .map((line) => line.trim())
    .some(
      (line) =>
        line === GITIGNORE_ENTRY ||
        line === "/.hexagen/" ||
        line === ".hexagen/" ||
        line === ".hexagen",
    );
  if (alreadyCovered) return;
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await appendFile(
    gitignorePath,
    `${prefix}# added by \`hexagen grant issue\` — never commit the signing trust root\n${GITIGNORE_ENTRY}\n`,
  );
}

function validateKeyHex(keyHex: string, keyPath: string): void {
  if (
    keyHex.length !== REQUIRED_KEY_HEX_LENGTH ||
    !/^[0-9a-f]+$/i.test(keyHex)
  ) {
    throw new Error(
      `Signing key at ${keyPath} must be exactly ${REQUIRED_KEY_HEX_LENGTH} hex characters ` +
        `(32 bytes) — got ${keyHex.length}. Refusing to sign with a key that isn't full strength.`,
    );
  }
}

/**
 * Reads the trust root `GrantSignatureAdapter.verify` checks against
 * (`<workspaceRoot>/.hexagen/grant-signing.key`). If it doesn't exist yet,
 * mints a fresh 32-byte random key and writes it — per
 * `docs/kernel/GRANT.md` "No issuer exists yet": "create it ... if it
 * doesn't exist; treat it like any other credential, never commit it." The
 * caller is told whether a key was just created, so it can warn loudly
 * (this is a secret landing on disk in a git working tree).
 *
 * Key creation uses exclusive (`wx`) file creation: if two `grant issue`
 * invocations race on a fresh workspace, the loser's write fails with
 * EEXIST and it re-reads the winner's key instead of overwriting it —
 * otherwise both would sign with different keys while only one survives on
 * disk, and the loser's grant would never verify.
 */
export async function loadOrCreateSigningKey(
  workspaceRoot: string,
): Promise<LoadedSigningKey> {
  const keyPath = path.join(workspaceRoot, ...SIGNING_KEY_RELATIVE_PATH);
  try {
    const keyHex = (await readFile(keyPath, "utf-8")).trim();
    validateKeyHex(keyHex, keyPath);
    return { keyHex, created: false, path: keyPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const keyHex = randomBytes(32).toString("hex");
  await mkdir(path.dirname(keyPath), { recursive: true });
  await ensureKeyIsGitignored(workspaceRoot);
  try {
    await writeFile(keyPath, `${keyHex}\n`, { mode: 0o600, flag: "wx" });
    return { keyHex, created: true, path: keyPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const winnerKeyHex = (await readFile(keyPath, "utf-8")).trim();
    validateKeyHex(winnerKeyHex, keyPath);
    return { keyHex: winnerKeyHex, created: false, path: keyPath };
  }
}
