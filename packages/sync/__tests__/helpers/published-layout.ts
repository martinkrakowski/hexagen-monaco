/**
 * Published-layout fixture + process plumbing shared by the contract suites
 * (exit-codes PR-A1, dry-run purity PR-A2). Extracted from
 * exit-codes.contract.test.ts so both suites pin the SAME consumer layout.
 *
 * Layout matters: `findWorkspaceRoot` (sync-engine-init.ts) probes cwd first
 * (Wave-C, the npx/global fix), then falls back to the module's own
 * __dirname. The suites spawn with cwd = fixture root, so cwd resolution
 * already lands on the fixture — but the fixture still replicates the
 * published layout:
 *
 *   <fixture>/node_modules/@hexagen-monaco/sync/dist/   ← physical COPY
 *
 * Two reasons the copy stays load-bearing: it pins the ARTIFACT a consumer
 * actually runs (a bundled dist, not the repo's TS sources), and it keeps the
 * __dirname FALLBACK honest. With cwd-first resolution working, the copy is
 * the front line: the lstat copy-not-symlink assertion in
 * createPublishedLayoutFixture is what stops a symlinked dist from silently
 * re-pointing the fallback at the HOST repo. The exit-codes suite's canary
 * still catches a host-leak end-to-end, but only if cwd resolution ALSO
 * regresses (both probes failing) — it no longer demonstrates a __dirname-only
 * regression on its own.
 *
 * A copy, not a symlink: the ESM loader realpaths import.meta.url, so a
 * symlinked dist would walk up from the repo again. The tsup bundle keeps
 * commander / js-yaml / ts-morph external (ADR-0068) — those ARE symlinked
 * into the fixture's node_modules, because Node resolves their own deps from
 * their realpath inside the host repo, which is exactly what we want.
 *
 * `hexagen-lint` resolves its root from process.cwd() instead, so a .bin shim
 * that exec's the repo's built linter is faithful for it.
 *
 * POSIX-only: the .bin shim is a shell script. Dev and CI are darwin/linux;
 * win32 would need a .cmd shim, so the suites skip there instead of lying.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFixture, removeFixture } from "./fixture-factory.js";
import { pathExists } from "./fs-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
export const SYNC_DIST = path.join(REPO_ROOT, "packages", "sync", "dist");
// The `hexagen-lint` bin target after the GOD-002 split: dist/cli.js carries the
// CLI bootstrap + checkArchitecturalIntegrity() side effects. dist/index.js is
// now the side-effect-free library barrel and must NOT be exec'd as the bin.
export const LINTER_DIST = path.join(
  REPO_ROOT,
  "tools",
  "arch-linter",
  "dist",
  "cli.js",
);
// Externalized by tsup (ADR-0068) — must be resolvable next to the copied dist.
export const EXTERNALS = ["commander", "js-yaml", "ts-morph", "zod"];

/**
 * True on Windows. Use it ONLY where a fixture genuinely cannot run there,
 * and say why at the use site.
 *
 * It used to guard twelve suites with no recorded reason. Running them on
 * Windows (2026-08-24) showed eleven were fine once a real product defect was
 * fixed — `hexagen-lint` compared a ts-morph path against a native one and so
 * scanned zero files on Windows, which the blanket skip had hidden. The one
 * surviving use is the journaled-rollback describe in
 * sync-engine-errors-selfregen.test.ts, whose fixture shells out to a
 * sh-shebang preflight stub that cannot exec on win32; that use site carries
 * the explanation.
 *
 * A skip without a stated reason is indistinguishable from a gap nobody chose.
 */
export const SKIP_NON_POSIX = process.platform === "win32";

export const VALID_MANIFEST = `system: acme-app
scope: acme
architecture: modular-monolith
bounded_contexts:
  - name: shared
    type: shared-kernel
    description: Shared primitives
    layers:
      domain: {}
`;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runProcess(
  file: string,
  args: string[],
  cwd: string,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // A numeric code means the binary ran to completion and chose its own
        // exit. Anything else (ENOENT/EACCES spawn failure, timeout, signal
        // kill) REJECTS instead of masquerading as exit≠0: most contract cases
        // expect failure, and a binary that never ran would otherwise satisfy
        // `assert.notEqual(code, 0)` without proving any CLI behaviour.
        if (error && typeof error.code !== "number") {
          reject(
            new Error(
              `${file} did not exit on its own (${error.code ?? error.signal ?? error.message})\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
            ),
          );
          return;
        }
        resolve({
          code: typeof error?.code === "number" ? error.code : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

export function runNode(
  scriptPath: string,
  args: string[],
  cwd: string,
): Promise<RunResult> {
  return runProcess(process.execPath, [scriptPath, ...args], cwd);
}

export interface ContractFixture {
  root: string;
  /** The consumer-side copy of dist/cli.js — the artifact under test. */
  cli: string;
  /** The consumer-side .bin shim for hexagen-lint. */
  lintBin: string;
}

export async function createPublishedLayoutFixture(
  manifestYaml: string,
  prefix = "hexagen-contract-",
): Promise<ContractFixture> {
  const root = await createFixture([], prefix);

  await fs.mkdir(path.join(root, "packages"), { recursive: true });
  await fs.mkdir(path.join(root, ".architecture"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".architecture", "manifest.yaml"),
    manifestYaml,
    "utf8",
  );

  const pkgDir = path.join(root, "node_modules", "@hexagen-monaco", "sync");
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.cp(SYNC_DIST, path.join(pkgDir, "dist"), { recursive: true });
  // Guard the copy-not-symlink invariant: a symlinked dist realpaths back
  // into the repo, and findWorkspaceRoot's __dirname FALLBACK would resolve
  // the HOST as workspace root (see header). lstat does not follow links, so
  // isDirectory() is false for a symlink.
  assert.ok(
    (await fs.lstat(path.join(pkgDir, "dist"))).isDirectory(),
    "fixture dist must be a physical copy, not a symlink",
  );
  // "type": "module" mirrors the published package.json — without it the
  // copied .js bundle would be loaded as CJS and top-level await would throw.
  await fs.writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: "@hexagen-monaco/sync",
        version: "0.0.0-contract",
        type: "module",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  for (const ext of EXTERNALS) {
    await fs.symlink(
      path.join(REPO_ROOT, "node_modules", ext),
      path.join(root, "node_modules", ext),
      "dir",
    );
  }

  const binDir = path.join(root, "node_modules", ".bin");
  // Direct spawn (execFile), not PATH resolution: on Windows the extensionless
  // file is not executable, so point at the .cmd sibling writeBinStub emits.
  const lintBin = path.join(
    binDir,
    process.platform === "win32" ? "hexagen-lint.cmd" : "hexagen-lint",
  );
  await writeBinStub(binDir, "hexagen-lint", {
    sh: `#!/bin/sh\nexec "${process.execPath}" "${LINTER_DIST}" "$@"\n`,
    cmd: `@echo off\r\n"${process.execPath}" "${LINTER_DIST}" %*\r\n`,
  });

  return { root, cli: path.join(pkgDir, "dist", "cli.js"), lintBin };
}

/**
 * Write an executable stub into a fixture's `node_modules/.bin`, in BOTH
 * forms the platforms need.
 *
 * npm/npx resolve a bin differently per platform: on POSIX they exec the
 * extensionless file and honour its shebang; on Windows they look for
 * `<name>.cmd` and cannot exec a `#!/bin/sh` file at all. Writing only the
 * POSIX form meant npx fell through to the REAL binary on Windows — which is
 * why the contract fixtures failed there with turbo's "could not resolve
 * workspaces" instead of using the stub, and why these suites were skipped
 * as "POSIX-only". They are not: the stub was.
 */
export async function writeBinStub(
  binDir: string,
  name: string,
  spec: { sh: string; cmd: string },
): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, name), spec.sh, { mode: 0o755 });
  // CRLF: cmd.exe is unreliable with LF-only batch files.
  await fs.writeFile(path.join(binDir, `${name}.cmd`), spec.cmd, {
    mode: 0o755,
  });
}

/** A stub that succeeds and does nothing (the preflight `turbo` case). */
export const EXIT_ZERO_STUB = {
  sh: "#!/bin/sh\nexit 0\n",
  cmd: "@echo off\r\nexit /b 0\r\n",
};

export function runHexagen(
  fix: ContractFixture,
  args: string[],
): Promise<RunResult> {
  return runNode(fix.cli, args, fix.root);
}

export function runLint(fix: ContractFixture): Promise<RunResult> {
  return runProcess(fix.lintBin, [], fix.root);
}

export function describeResult(r: RunResult): string {
  return `exit=${r.code}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

// finally-safe cleanup: a throwing fs.rm (EBUSY under CI, etc.) must never
// replace the test's own assertion error. Worst case is an orphaned tmp dir.
export async function cleanupFixture(root: string): Promise<void> {
  try {
    await removeFixture(root);
  } catch (err) {
    console.warn(`fixture cleanup failed (${root}):`, err);
  }
}

/**
 * `before()` guard for every contract suite: fail closed with a pointer
 * instead of a confusing spawn error — the suites test built artifacts, so
 * both dists must exist (turbo wires test→build).
 */
export async function assertBuiltArtifactsPresent(): Promise<void> {
  assert.ok(
    await pathExists(path.join(SYNC_DIST, "cli.js")),
    `missing ${SYNC_DIST}/cli.js — build @hexagen/sync before running the contract suite`,
  );
  assert.ok(
    await pathExists(LINTER_DIST),
    `missing ${LINTER_DIST} — build @hexagen/arch-linter before running the contract suite`,
  );
}
