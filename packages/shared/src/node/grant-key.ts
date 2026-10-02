import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The one place that decides which grant-signing key a process uses. The
 * `grant issue` CLI and the MCP server's `GrantSignatureAdapter` both call it,
 * so the key that signs a grant and the key that verifies it cannot drift.
 *
 * Node-only (fs, os, crypto). It is reached through the
 * `@hexagen/shared/node/grant-key` subpath and is deliberately NOT re-exported
 * from the package barrel, which the web app bundles.
 */

export const GRANT_KEY_ENV_VAR = "HEXAGEN_GRANT_KEY_FILE";

/** Hex characters in a full-strength key (32 bytes). */
export const GRANT_KEY_HEX_LENGTH = 64;

const ENGAGEMENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type GrantKeySource =
  | "key-file"
  | "env"
  | "engagement"
  | "repo"
  | "none";

export interface ResolveGrantKeyInput {
  readonly keyFile?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly engagementId?: string;
  readonly workspaceRoot: string;
  /** Injected for tests; defaults to `os.homedir()`. */
  readonly homeDir?: string;
}

export interface ResolvedGrantKey {
  /** Where the key is (or would be); null when nothing names a location. */
  readonly path: string | null;
  readonly source: GrantKeySource;
  /** First 16 hex chars of SHA-256 over the key bytes; only when the key reads. */
  readonly fingerprint?: string;
  /** `repo` when `<workspaceRoot>/.architecture/manifest.yaml` exists. */
  readonly mode: "repo" | "brownfield";
  /** Why the key could not be used, when it could not. Never contains key material. */
  readonly problem?: string;
}

/** Strict alphabet, 1-64 chars, and no `..` (so it can never climb out of the key dir). */
export function isValidEngagementId(id: string): boolean {
  return ENGAGEMENT_ID_PATTERN.test(id) && !id.includes("..");
}

export function isRepoMode(workspaceRoot: string): boolean {
  return existsSync(path.join(workspaceRoot, ".architecture", "manifest.yaml"));
}

export function repoKeyPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".hexagen", "grant-signing.key");
}

export function engagementKeyPath(
  engagementId: string,
  homeDir: string = os.homedir(),
): string {
  return path.join(homeDir, ".hexagen", "keys", `${engagementId}.key`);
}

export function keyFingerprint(keyHex: string): string {
  return createHash("sha256")
    .update(Buffer.from(keyHex, "hex"))
    .digest("hex")
    .slice(0, 16);
}

export type ReadKeyResult =
  | { readonly ok: true; readonly keyHex: string; readonly fingerprint: string }
  | { readonly ok: false; readonly missing: boolean; readonly problem: string };

/** Reads and validates the key at `keyPath`. Never returns key material in `problem`. */
export function readGrantKey(keyPath: string): ReadKeyResult {
  let raw: string;
  try {
    raw = readFileSync(keyPath, "utf-8").trim();
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      ok: false,
      missing,
      problem: missing
        ? `no key file at ${keyPath}`
        : `could not read ${keyPath}: ${(error as Error).message}`,
    };
  }
  if (raw.length !== GRANT_KEY_HEX_LENGTH || !/^[0-9a-f]+$/i.test(raw)) {
    return {
      ok: false,
      missing: false,
      problem: `key at ${keyPath} must be exactly ${GRANT_KEY_HEX_LENGTH} hex characters (32 bytes); got ${raw.length}`,
    };
  }
  return { ok: true, keyHex: raw, fingerprint: keyFingerprint(raw) };
}

function withFingerprint(
  base: Omit<ResolvedGrantKey, "fingerprint" | "problem">,
): ResolvedGrantKey {
  if (base.path === null) return base;
  const read = readGrantKey(base.path);
  return read.ok
    ? { ...base, fingerprint: read.fingerprint }
    : { ...base, problem: read.problem };
}

/**
 * Order: `keyFile` (--key-file), then `HEXAGEN_GRANT_KEY_FILE`, then
 * `~/.hexagen/keys/<engagement-id>.key`. In repo mode (a manifest exists) the
 * last step is the in-repo `.hexagen/grant-signing.key` instead, unchanged.
 */
export function resolveGrantKey(input: ResolveGrantKeyInput): ResolvedGrantKey {
  const mode = isRepoMode(input.workspaceRoot) ? "repo" : "brownfield";

  if (input.keyFile) {
    return withFingerprint({
      path: path.resolve(input.keyFile),
      source: "key-file",
      mode,
    });
  }
  const fromEnv = input.env[GRANT_KEY_ENV_VAR];
  if (fromEnv) {
    return withFingerprint({
      path: path.resolve(fromEnv),
      source: "env",
      mode,
    });
  }
  if (mode === "repo") {
    return withFingerprint({
      path: repoKeyPath(input.workspaceRoot),
      source: "repo",
      mode,
    });
  }
  if (input.engagementId === undefined) {
    return {
      path: null,
      source: "none",
      mode,
      problem:
        "no key location: pass --key-file, set HEXAGEN_GRANT_KEY_FILE, or name an engagement (--engagement or .hexagen/slice.json)",
    };
  }
  if (!isValidEngagementId(input.engagementId)) {
    return {
      path: null,
      source: "none",
      mode,
      problem: `invalid engagement id (allowed: A-Z a-z 0-9 . _ -, 1-64 chars, no "..")`,
    };
  }
  return withFingerprint({
    path: engagementKeyPath(input.engagementId, input.homeDir),
    source: "engagement",
    mode,
  });
}

/**
 * The engagement id recorded in `<workspaceRoot>/.hexagen/slice.json`, or
 * undefined when the file is absent, unreadable, or has no string `id`.
 */
export function readSliceEngagementId(
  workspaceRoot: string,
): string | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(workspaceRoot, ".hexagen", "slice.json"), "utf-8"),
    );
    const id = (parsed as { id?: unknown } | null)?.id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/** One log line naming where a process looks for its key; never the key. */
export function describeResolvedKey(
  workspaceRoot: string,
  key: ResolvedGrantKey,
): string {
  return (
    `workspace root ${workspaceRoot}; key ${key.path ?? "(none)"} ` +
    `[${key.source}]; fingerprint ${key.fingerprint ?? "(unavailable)"}` +
    (key.problem ? `; ${key.problem}` : "")
  );
}

/**
 * Null when both resolutions reach the same key; otherwise a message naming
 * both paths and fingerprints, so a CLI/MCP split is diagnosable at a glance.
 */
export function describeKeyMismatch(
  labelA: string,
  a: ResolvedGrantKey,
  labelB: string,
  b: ResolvedGrantKey,
): string | null {
  if (a.fingerprint !== undefined && a.fingerprint === b.fingerprint) {
    return null;
  }
  const side = (label: string, k: ResolvedGrantKey): string =>
    `${label}: ${k.path ?? "(none)"} fingerprint ${k.fingerprint ?? "(unavailable)"}`;
  return `grant key mismatch. ${side(labelA, a)}; ${side(labelB, b)}`;
}
