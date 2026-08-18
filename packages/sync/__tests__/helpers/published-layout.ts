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
 * commander / js-yaml / ts-morph external (ADR-0009) — those ARE symlinked
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
// Externalized by tsup (ADR-0009) — must be resolvable next to the copied dist.
export const EXTERNALS = ["commander", "js-yaml", "ts-morph", "zod"];

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
  await fs.mkdir(binDir, { recursive: true });
  const lintBin = path.join(binDir, "hexagen-lint");
  await fs.writeFile(
    lintBin,
    `#!/bin/sh\nexec "${process.execPath}" "${LINTER_DIST}" "$@"\n`,
    { mode: 0o755 },
  );

  return { root, cli: path.join(pkgDir, "dist", "cli.js"), lintBin };
}

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
