import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "../../../lib/structured-logger";

/**
 * Where scan workspaces live — and why that is deliberately NOT `os.tmpdir()`.
 *
 * `hexagen scan` does not check anything by itself: it shells out to a second
 * binary, `hexagen-lint`, and `resolveArchLinterBin` (packages/sync) finds that
 * binary by walking UP from the directory being scanned, looking for
 * `node_modules/.bin/hexagen-lint` or `node_modules/@hexagen{,-monaco}/arch-linter`
 * at each level. There is no PATH fallback and no env override — the walk is the
 * whole contract.
 *
 * A workspace created under `os.tmpdir()` therefore produces the walk
 * `/tmp/hexagen-scan-xxxx` -> `/tmp` -> `/`, which terminates without ever
 * passing the application root. In the container that is `/app`, so
 * `/app/node_modules` — the only `node_modules` in the image — is never even
 * looked at. The scan still runs, still writes `layout.yaml` and a report, and
 * still returns `findings.collected: false` with
 * `failureReason: "hexagen-lint binary was not found"`: a scan that checks
 * nothing while reporting success-shaped output.
 *
 * The fix is to put the workspace somewhere whose PARENT CHAIN reaches that
 * `node_modules`. `<appRoot>/.scan-workspaces/hexagen-scan-xxxx` walks
 * `.../hexagen-scan-xxxx` -> `<appRoot>/.scan-workspaces` -> `<appRoot>`, and
 * `<appRoot>/node_modules` is checked at the third step.
 *
 * Deliberately NOT done here: changing the resolver. `@hexagen/sync` is a
 * published package and its resolution order is a contract shared with generated
 * projects; a PATH fallback there would be a different (and much wider) change.
 *
 * Two consequences of leaving the OS temp directory that callers must respect:
 *
 *  - **Nothing sweeps this directory.** `/tmp` is cleaned by the OS on reboot
 *    (and by systemd-tmpfiles on a schedule); `<appRoot>/.scan-workspaces` is
 *    not cleaned by anything. Every creator must remove its workspace in a
 *    `finally`, on success, on failure, on timeout and on client disconnect.
 *  - **The base directory must exist and be writable by the runtime user.** The
 *    image runs as non-root `nextjs` and only explicitly `chown`ed directories
 *    are writable, so `apps/web/Dockerfile` pre-creates and chowns this one, the
 *    same way it does for `/data`.
 */

/**
 * Operator override, absolute path. Set by `apps/web/Dockerfile` so the
 * container's answer is a visible line in the image definition rather than the
 * output of the heuristic below. When it is set and unusable the resolver does
 * NOT silently ignore it — it reports it as the reason for degrading.
 */
export const SCAN_WORKSPACE_DIR_ENV = "HEXAGEN_SCAN_WORKSPACE_DIR";

/** Directory name created under the application root. */
export const SCAN_WORKSPACE_DIR_NAME = ".scan-workspaces";

export type ScanWorkspaceSource = "env" | "app-root" | "os-tmp";

export interface ScanWorkspaceBase {
  /** Directory that `mkdtemp` should be called against. Always absolute. */
  readonly dir: string;
  readonly source: ScanWorkspaceSource;
  /**
   * `null` when `dir` is the intended location. Otherwise a sentence naming
   * every candidate that was tried and why it was rejected.
   *
   * A non-null value means `source === "os-tmp"`, i.e. the bug this module
   * exists to prevent is back. It is returned rather than only logged so the
   * condition is assertable in a test — `logger` is a no-op under `NODE_ENV=test`.
   */
  readonly degradedReason: string | null;
}

export interface ResolveScanWorkspaceOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  /**
   * Create `dir` and confirm the process can write into it. Returns `null` on
   * success, or a reason string. Injected only so a test can exercise the
   * degrade path without needing an unwritable directory on the host.
   */
  readonly ensureDir?: (dir: string) => string | null;
  readonly findAppRoot?: (from: string) => string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create `dir` (recursively) and prove it is a directory this process can write
 * into and traverse. `mkdirSync` succeeding is not sufficient: it is a no-op
 * when the path already exists, including when it exists as a root-owned
 * directory the runtime user cannot write, which is precisely the failure the
 * Dockerfile's `chown` prevents.
 */
function ensureWritableDir(dir: string): string | null {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    return messageOf(error);
  }
  try {
    if (!statSync(dir).isDirectory()) return "exists but is not a directory";
    accessSync(dir, constants.W_OK | constants.X_OK);
  } catch (error) {
    return messageOf(error);
  }
  return null;
}

/**
 * The application root: the nearest ancestor of `from` whose `package.json`
 * declares `workspaces`.
 *
 * That field is the anchor because it holds in both places this code runs. In
 * the container the Next standalone output is copied to `/app` with the
 * monorepo's own root `package.json` at `/app/package.json` (`workspaces:
 * ["apps/*", "packages/*", "tools/*"]`), and `/app/node_modules` sits beside it.
 * In development the walk starts at `apps/web` — whose `package.json` has no
 * `workspaces` — and lands on the repository root, which is likewise where
 * `node_modules/.bin/hexagen-lint` is.
 *
 * Deliberately not `.architecture/manifest.yaml` (the anchor `findMonorepoRoot`
 * uses): the standalone output does not contain it. Deliberately not "nearest
 * ancestor containing a `node_modules`" either — in development that is
 * `apps/web`, and creating scan workspaces under the Next project directory
 * makes every scan churn the dev file watcher.
 *
 * Returns `null` at the filesystem root rather than guessing.
 */
export function findAppRoot(from: string): string | null {
  let dir = path.resolve(from);
  for (;;) {
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      );
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { workspaces?: unknown }).workspaces !== undefined
      ) {
        return dir;
      }
    } catch {
      // No package.json here, or an unreadable/malformed one. Keep walking —
      // a broken manifest at one level says nothing about the levels above it.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the base directory for scan workspaces. Pure with respect to logging;
 * the only side effect is creating the directory it returns.
 *
 * Order: the env override, then the application root, then `os.tmpdir()`. The
 * last one is a DEGRADED answer, never a silent equivalent — see
 * {@link ScanWorkspaceBase.degradedReason}.
 */
export function resolveScanWorkspaceBase(
  options: ResolveScanWorkspaceOptions = {},
): ScanWorkspaceBase {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const ensureDir = options.ensureDir ?? ensureWritableDir;
  const appRootOf = options.findAppRoot ?? findAppRoot;

  const rejected: string[] = [];

  const configured = (env[SCAN_WORKSPACE_DIR_ENV] ?? "").trim();
  if (configured !== "") {
    if (!path.isAbsolute(configured)) {
      rejected.push(
        `${SCAN_WORKSPACE_DIR_ENV}="${configured}" is not an absolute path`,
      );
    } else {
      const failure = ensureDir(configured);
      if (failure === null) {
        return { dir: configured, source: "env", degradedReason: null };
      }
      rejected.push(`${SCAN_WORKSPACE_DIR_ENV}="${configured}": ${failure}`);
    }
  }

  const appRoot = appRootOf(cwd);
  if (appRoot === null) {
    rejected.push(
      `no application root (a package.json declaring "workspaces") at or above ${cwd}`,
    );
  } else {
    const dir = path.join(appRoot, SCAN_WORKSPACE_DIR_NAME);
    const failure = ensureDir(dir);
    if (failure === null) {
      return { dir, source: "app-root", degradedReason: null };
    }
    rejected.push(`${dir}: ${failure}`);
  }

  return {
    dir: tmpdir(),
    source: "os-tmp",
    degradedReason: rejected.join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* Stale sweep                                                         */
/* ------------------------------------------------------------------ */

/** Prefixes every scan workspace is created with. Nothing else is ever removed. */
export const SCAN_WORKSPACE_PREFIXES = [
  "hexagen-scan-",
  "hexagen-clone-",
  "hexagen-handoff-",
] as const;

/**
 * Age past which an abandoned workspace is swept.
 *
 * Comfortably above every route budget — the longest is the GitHub scan's
 * `maxDuration = 120`s — so a workspace still in use can never match. It is an
 * hour rather than five minutes because the cost of being wrong in that
 * direction is deleting a directory a live request is reading.
 */
export const STALE_WORKSPACE_MS = 60 * 60 * 1000;

/**
 * Remove abandoned workspaces under `dir`.
 *
 * This exists because leaving `os.tmpdir()` also leaves everything that sweeps
 * it: `/tmp` is cleared on reboot and by the host's tmpfiles timer, while
 * `<appRoot>/.scan-workspaces` is cleared by nothing at all. Every creator does
 * delete its own workspace in a `finally`, but a `finally` does not run when the
 * container is killed mid-scan (OOM, redeploy, SIGKILL) — and in a long-lived
 * container that residue is permanent, so it needs an owner.
 *
 * Matching is by the creators' own prefixes and by age; anything else in the
 * directory is left alone. Returns the names removed, for tests.
 */
export async function sweepStaleWorkspaces(
  dir: string,
  options: { readonly now?: number; readonly olderThanMs?: number } = {},
): Promise<string[]> {
  const now = options.now ?? Date.now();
  const olderThanMs = options.olderThanMs ?? STALE_WORKSPACE_MS;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of entries) {
    if (!SCAN_WORKSPACE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      continue;
    }
    const full = path.join(dir, name);
    try {
      // `lstat`, not `stat`: a symlink that happens to carry one of our
      // prefixes must never be treated as a directory to recurse into. Same
      // discipline as clone.ts's size sampler.
      const info = await lstat(full);
      if (!info.isDirectory()) continue;
      if (now - info.mtimeMs < olderThanMs) continue;
      await rm(full, { recursive: true, force: true });
      removed.push(name);
    } catch {
      // Raced with the owning request, or not ours to delete. Either way the
      // next sweep gets it; a failed sweep must never fail a scan.
    }
  }
  return removed;
}

/** Base already swept in this process, so the sweep runs once, not per scan. */
let sweptBase: string | null = null;

/** Last degrade already reported, so a busy server logs it once, not per scan. */
let lastReportedDegrade: string | null = null;

/**
 * The directory to `mkdtemp` scan workspaces in, with the degrade reported.
 *
 * How a silent regression would be noticed, in the order it becomes visible:
 *
 *  1. This function logs at ERROR the first time it degrades, naming the
 *     directories it rejected and the override that would fix it. That line is
 *     the intended alert; `os.tmpdir()` never appears here without it.
 *  2. Failing that, the scan itself still reports the consequence: the envelope
 *     comes back `findings.collected: false` with
 *     `failureReason: "hexagen-lint binary was not found"`, which is exactly the
 *     production symptom this module was written to remove.
 *
 * The log is best-effort by design (`logger` is silent under `NODE_ENV=test`);
 * assert on {@link resolveScanWorkspaceBase} instead of on the log.
 */
export function scanWorkspaceBaseDir(): string {
  const base = resolveScanWorkspaceBase();
  if (base.degradedReason !== null) {
    if (base.degradedReason !== lastReportedDegrade) {
      lastReportedDegrade = base.degradedReason;
      logger.error(
        "Scan workspaces fell back to the OS temp directory. `hexagen scan` resolves hexagen-lint by walking up from the scanned directory, and that walk cannot reach the application's node_modules from there — every scan will report findings.collected=false.",
        {
          fallbackDir: base.dir,
          rejected: base.degradedReason,
          fix: `set ${SCAN_WORKSPACE_DIR_ENV} to an absolute, writable directory inside the application root`,
        },
      );
    }
  } else {
    lastReportedDegrade = null;
  }

  // Fire-and-forget, once per process per base, and never on the OS temp
  // directory (the host already sweeps that one, and it is shared with
  // everything else on the machine).
  if (base.source !== "os-tmp" && sweptBase !== base.dir) {
    sweptBase = base.dir;
    void sweepStaleWorkspaces(base.dir)
      .then((removed) => {
        if (removed.length > 0) {
          logger.warn(
            "Swept abandoned scan workspaces. Each one is a run whose cleanup never got to execute — expected after a kill or a redeploy mid-scan, worth investigating if it recurs.",
            { baseDir: base.dir, removed: removed.length },
          );
        }
      })
      .catch(() => {
        // A sweep failure is never allowed to affect the scan that triggered it.
      });
  }

  return base.dir;
}

/**
 * Where the application is INSTALLED — the directory whose `node_modules` holds
 * the `hexagen` CLI. This is not the same question as "where is this repo's
 * architecture manifest", and conflating the two is what broke production.
 *
 * Both scan entry points resolved the CLI with `resolveHexagenBin(findMonorepoRoot())`.
 * `findMonorepoRoot` walks up for `.architecture/manifest.yaml` and THROWS when
 * it is absent — and the Next standalone image contains no yaml at all, so
 * every server-side scan failed before it ever looked for a binary. The
 * manifest was never read by this path: the root reached exactly one call,
 * `resolveBin(workspaceRoot)`. It was a required file that nothing required.
 *
 * Anchoring on the workspaces manifest instead asks the question the caller
 * actually has. Verified against the running container: `/app/package.json`
 * declares `workspaces`, and `/app/.architecture` does not exist.
 *
 * Other `findMonorepoRoot` consumers -- governance, manifest lint, route path
 * validation -- genuinely do read the manifest and are deliberately untouched.
 */
export function resolveInstallationRoot(from: string = process.cwd()): string {
  const appRoot = findAppRoot(from);
  if (appRoot !== null) return appRoot;
  // Falling back to cwd rather than throwing: a missing binary is already a
  // first-class outcome downstream (`resolveHexagenBin` returns null and the
  // caller reports scan_could_not_run), so a wrong-but-plausible root degrades
  // into that path instead of turning a packaging question into a 500.
  return path.resolve(from);
}
