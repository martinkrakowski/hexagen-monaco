/* eslint-disable no-console */
import { randomBytes } from "node:crypto";
import { open, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { isRepoMode, readGrantKey } from "@hexagen/shared/node/grant-key";
import { canonicalGrantPayload } from "./canonical.js";
import { signGrantPayload } from "./sign.js";
import { discoverWorkspaceRoot, loadSlice } from "./workspace.js";
import { isoDateTime, loadGrantFile, verifyGrantSignature } from "./verify.js";
import { resolveSidecarOut } from "../shared/sidecar-out.js";

export interface RevokeOptions {
  grantFile: string;
  /** ISO date-time with an offset; default now. */
  at?: string;
  workspaceRoot?: string;
  keyFile?: string;
  engagement?: string;
  yes?: boolean;
  /** Test seams. */
  homeDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
}

function fail(code: 1 | 2, message: string): void {
  console.error(message);
  process.exitCode = code;
}

/** Temp file in the grant's own directory, then an atomic rename over it: a reader sees the old or the new grant, never a partial one. */
async function replaceFileAtomically(
  target: string,
  text: string,
  mode: number,
): Promise<void> {
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = await open(tmp, "wx", mode);
  try {
    try {
      await handle.writeFile(text, "utf-8");
    } finally {
      await handle.close();
    }
    await rename(tmp, target);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/**
 * `hexagen grant revoke <grant-file> [--at <iso>] [--yes]`: set `revoked_at`
 * and re-sign with the key that verifies the grant. Refuses a grant whose
 * signature does not verify under the resolved key (exit 1): it never signs
 * what it cannot vouch for. Idempotent: an already-revoked grant is left
 * untouched unless `--at` is earlier than the recorded time. Exit 0 done or
 * already revoked, 1 not verified, 2 bad input or no `--yes`. Never prints the
 * key; prints its path and fingerprint.
 */
export async function grantRevokeCommand(
  options: RevokeOptions,
): Promise<void> {
  const now = options.now ?? new Date();
  if (options.at !== undefined) {
    if (!isoDateTime.safeParse(options.at).success) {
      return fail(
        2,
        `--at must be an ISO date-time with an offset, e.g. 2026-10-01T18:00:00Z; got '${options.at}'`,
      );
    }
  }
  const loaded = await loadGrantFile(options.grantFile);
  if (!loaded.ok) return fail(2, loaded.problem);
  const { grant } = loaded;

  let workspaceRoot: string;
  try {
    workspaceRoot = discoverWorkspaceRoot(options.workspaceRoot);
  } catch (error) {
    return fail(2, (error as Error).message);
  }
  let target = path.resolve(options.grantFile);
  if (!isRepoMode(workspaceRoot)) {
    try {
      await loadSlice(workspaceRoot);
    } catch (error) {
      return fail(
        2,
        `.hexagen/slice.json is not a valid slice: ${(error as Error).message}`,
      );
    }
    const inside = await resolveSidecarOut(workspaceRoot, target).catch(
      () => null,
    );
    if (!inside) {
      return fail(
        2,
        `the grant file must be under ${path.join(workspaceRoot, ".hexagen")}${path.sep}; got "${options.grantFile}"`,
      );
    }
    target = inside;
  }

  const verification = verifyGrantSignature(grant, {
    workspaceRoot,
    keyFile: options.keyFile,
    engagement: options.engagement,
    env: options.env ?? process.env,
    homeDir: options.homeDir,
  });
  if (!verification.verified || verification.key.path === null) {
    return fail(
      1,
      `refusing to revoke grant '${grant.id}': its signature is not verified: ${verification.reason}. Nothing was written.`,
    );
  }
  const keyPath = verification.key.path;

  const requested = options.at ?? now.toISOString();
  const earlier =
    grant.revoked_at !== undefined &&
    options.at !== undefined &&
    Date.parse(options.at) < Date.parse(grant.revoked_at);
  if (grant.revoked_at !== undefined && !earlier) {
    console.log(
      `grant '${grant.id}' already revoked at ${grant.revoked_at}; nothing written.`,
    );
    process.exitCode = 0;
    return;
  }

  const read = readGrantKey(keyPath);
  if (!read.ok) return fail(1, read.problem);
  if (read.fingerprint !== verification.key.fingerprint) {
    return fail(1, "key changed during revoke; nothing written");
  }

  console.error(
    `[grant revoke] preflight, will write:\n  - grant file: ${target} (revoked_at ${grant.revoked_at ?? "(unset)"} -> ${requested}, re-signed with key ${keyPath})`,
  );
  if (Date.parse(requested) > now.getTime()) {
    console.error(
      "[grant revoke] warning: --at is in the future: this schedules the revocation; the grant stays valid until then",
    );
  }
  if (Date.parse(requested) >= Date.parse(grant.expires_at)) {
    console.error(
      "[grant revoke] warning: --at is at or after expires_at: the revocation has no effect",
    );
  }
  if (!options.yes) {
    return fail(
      2,
      "[grant revoke] nothing written; re-run with --yes to proceed.",
    );
  }

  const revoked = { ...grant, revoked_at: requested };
  const signed = {
    ...revoked,
    signature: signGrantPayload(canonicalGrantPayload(revoked), read.keyHex),
  };
  try {
    // Write through a symlink's target, not over the link itself.
    const real = await realpath(target);
    const mode = (await stat(real)).mode & 0o777;
    await replaceFileAtomically(
      real,
      `${JSON.stringify(signed, null, 2)}\n`,
      mode,
    );
  } catch (error) {
    return fail(
      2,
      `[grant revoke] could not write ${target}: ${(error as Error).message}`,
    );
  }
  console.log(
    [
      `revoked grant '${grant.id}' at ${requested}`,
      `grant file ${target}`,
      `key ${keyPath} [${verification.key.source}]`,
      `fingerprint ${read.fingerprint}`,
    ].join("\n"),
  );
  process.exitCode = 0;
}
