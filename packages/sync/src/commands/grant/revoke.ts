/* eslint-disable no-console */
import { randomBytes } from "node:crypto";
import { open, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  describeKeyMismatch,
  isRepoMode,
  readGrantKey,
  readSliceEngagementId,
  resolveGrantKey,
} from "@hexagen/shared/node/grant-key";
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
  /** Runs after the temp file is written, before the final containment re-check and the rename. */
  beforeRename?: () => Promise<void>;
}

function fail(code: 1 | 2, message: string): void {
  console.error(message);
  process.exitCode = code;
}

/** True when `child` is strictly inside `parent` (both already real paths). */
function isStrictlyInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

class RefusedError extends Error {}

/**
 * Temp file in the grant's own directory, then an atomic rename over it: a
 * reader sees the old or the new grant, never a partial one. The temp file is
 * chmod-ed to `mode` explicitly so the umask cannot narrow the original bits.
 * `guard` runs immediately before the rename.
 */
async function replaceFileAtomically(
  target: string,
  text: string,
  mode: number,
  guard: () => Promise<void>,
): Promise<void> {
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = await open(tmp, "wx", mode);
  try {
    try {
      await handle.writeFile(text, "utf-8");
      await handle.chmod(mode);
    } finally {
      await handle.close();
    }
    await guard();
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
 * already revoked, 1 not verified, 2 bad input, a held lock or no `--yes`.
 * Never prints the key; prints its path and fingerprint.
 *
 * The grant path is resolved once. In a client repo it must be under the real
 * `<root>/.hexagen/`, and that containment is re-checked on the directory
 * right before the rename. Residual window: between that last check and the
 * rename itself nothing is held, so an attacker who can already write inside
 * `.hexagen/` and swap its ancestors in that instant can still redirect the
 * rename; the guard narrows the window, it does not close it (the same
 * trade-off the sidecar writers make). A `<grant>.lock` file (O_EXCL, holding
 * the pid, never auto-broken) serialises concurrent revokes.
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
  const early = await loadGrantFile(options.grantFile);
  if (!early.ok) return fail(2, early.problem);

  let workspaceRoot: string;
  try {
    workspaceRoot = discoverWorkspaceRoot(options.workspaceRoot);
  } catch (error) {
    return fail(2, (error as Error).message);
  }
  const brownfield = !isRepoMode(workspaceRoot);
  let sidecarReal: string | undefined;
  let target = path.resolve(options.grantFile);
  if (brownfield) {
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
    sidecarReal = path.join(await realpath(workspaceRoot), ".hexagen");
  }
  // Resolve once; every later step uses this path.
  try {
    target = await realpath(target);
  } catch (error) {
    return fail(2, `cannot resolve ${target}: ${(error as Error).message}`);
  }
  if (sidecarReal !== undefined && !isStrictlyInside(sidecarReal, target)) {
    return fail(
      2,
      `the grant file must be under ${sidecarReal}${path.sep}; it resolves to "${target}"`,
    );
  }

  const lockPath = `${target}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(`${process.pid}\n`);
    await lock.close();
  } catch (error) {
    await lock?.close().catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return fail(
        2,
        `[grant revoke] another revoke holds ${lockPath}; if no revoke is running, delete that file and retry. Nothing written.`,
      );
    }
    return fail(
      2,
      `[grant revoke] cannot create ${lockPath}: ${(error as Error).message}`,
    );
  }
  try {
    await revokeLocked(options, now, workspaceRoot, target, sidecarReal);
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}

async function revokeLocked(
  options: RevokeOptions,
  now: Date,
  workspaceRoot: string,
  target: string,
  sidecarReal: string | undefined,
): Promise<void> {
  // Under the lock: re-read and re-verify, then decide.
  const loaded = await loadGrantFile(target);
  if (!loaded.ok) return fail(2, loaded.problem);
  const { grant } = loaded;
  const env = options.env ?? process.env;

  const verification = verifyGrantSignature(grant, {
    workspaceRoot,
    keyFile: options.keyFile,
    engagement: options.engagement,
    env,
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

  if (options.keyFile || options.engagement) {
    const server = resolveGrantKey({
      env,
      engagementId: readSliceEngagementId(workspaceRoot),
      workspaceRoot,
      homeDir: options.homeDir,
    });
    if (server.path !== null) {
      const mismatch = describeKeyMismatch(
        "revoking with",
        verification.key,
        "server default",
        server,
      );
      if (mismatch) {
        console.error(
          `[grant revoke] warning: ${mismatch}. The server will deny this grant as a signature failure, not report it as revoked.`,
        );
      }
    }
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
    const mode = (await stat(target)).mode & 0o777;
    await replaceFileAtomically(
      target,
      `${JSON.stringify(signed, null, 2)}\n`,
      mode,
      async () => {
        await options.beforeRename?.();
        if (sidecarReal === undefined) return;
        const dir = await realpath(path.dirname(target));
        if (dir !== sidecarReal && !isStrictlyInside(sidecarReal, dir)) {
          throw new RefusedError(
            `the grant's directory now resolves outside ${sidecarReal}${path.sep}`,
          );
        }
      },
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
