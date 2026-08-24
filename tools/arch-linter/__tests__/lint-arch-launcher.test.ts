/**
 * Exit-code contract for the `yarn lint:arch` entry point.
 *
 * THE DEFECT. `lint:arch` used to be a bare `node dist/cli.js`. `dist/` is a
 * gitignored build artifact, so on an unbuilt tree the architecture gate died
 * inside Node's module loader with a raw `MODULE_NOT_FOUND` stack trace that
 * never mentioned architecture, linting, or the fact that nothing had been
 * checked — and it exited **1**, the same code the linter returns after a
 * successful run that found violations. "The gate found problems" and "the gate
 * never ran" were the same signal. `.github/workflows/lint.yml` builds the
 * linter before invoking it precisely because of this; if that step is ever
 * reordered or dropped, nothing else notices.
 *
 * The vocabulary these tests pin:
 *
 *     0  ran to completion, compliant
 *     1  ran to completion, found violations
 *     2  could not run — nothing was checked
 *
 * The unrunnable case is exercised on a COPY of the real launcher placed in a
 * directory with no sibling `dist/`, so it tests the shipped file rather than a
 * test-only switch, and needs no mutation of the repo's own build output.
 */
import { describe, it, beforeAll } from "vitest";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.join(__dirname, "..");
const LAUNCHER = path.join(PACKAGE_DIR, "bin", "lint-arch.mjs");
const BUILT_CLI = path.join(PACKAGE_DIR, "dist", "cli.js");

const SKIP_NON_POSIX = false; // PROBE(explore/win32-unskip): run everything on Windows to see what breaks

const MANIFEST = `system: acme-app
scope: acme
architecture: modular-monolith
bounded_contexts:
  - name: billing
    type: core
    description: Billing
    layers:
      domain: {}
  - name: orders
    type: core
    description: Orders
    layers:
      domain: {}
`;

/** billing imports orders with no `depends_on` grant — a boundary violation. */
const VIOLATING_SOURCE = `import { x } from "@acme/orders";\nexport const y = x;\n`;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, ...args],
      { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(
            new Error(
              `launcher did not exit on its own (${error.code ?? error.signal ?? error.message})`,
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

function describeResult(r: RunResult): string {
  return `exit=${r.code}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), prefix));
}

/**
 * A minimal lintable project. `realpath` matters: on macOS `os.tmpdir()` is a
 * symlink and ts-morph reports realpaths, so an unresolved root would match
 * zero source files and every assertion below would pass vacuously.
 */
async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await makeTempDir("hexagen-lint-launcher-");
  for (const [rel, contents] of Object.entries(files)) {
    const target = path.join(root, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  return root;
}

const BASE_FILES: Record<string, string> = {
  ".architecture/manifest.yaml": MANIFEST,
  "tsconfig.base.json": `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true } }\n`,
  "package.json": `{ "name": "fixture-root", "private": true, "workspaces": ["packages/*"] }\n`,
  "packages/orders/src/index.ts": `export const x = 1;\n`,
};

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`fixture cleanup failed (${dir}):`, err);
  }
}

describe(
  "yarn lint:arch — an unrunnable linter is a failure, not a pass",
  { skip: SKIP_NON_POSIX },
  () => {
    beforeAll(async () => {
      assert.ok(
        await fs
          .stat(BUILT_CLI)
          .then(() => true)
          .catch(() => false),
        `missing ${BUILT_CLI} — build @hexagen/arch-linter before running this suite`,
      );
    });

    it("exits 2 with an explicit 'NOTHING WAS CHECKED' message when the linter is not built", async () => {
      // The real launcher, relocated so that `../dist/cli.js` does not exist —
      // exactly the state of a fresh checkout or a CI job that skipped the build.
      const dir = await makeTempDir("hexagen-lint-unbuilt-");
      try {
        const relocated = path.join(dir, "bin", "lint-arch.mjs");
        await fs.mkdir(path.dirname(relocated), { recursive: true });
        await fs.copyFile(LAUNCHER, relocated);

        const r = await run(relocated, [], dir);

        // Not 0 (a pass), and not 1 either — 1 is what a successful run that
        // found violations returns, and these two must not be confusable.
        assert.equal(r.code, 2, describeResult(r));
        assert.match(r.stderr, /NOTHING WAS CHECKED/, describeResult(r));
        assert.match(r.stderr, /could not run/i, describeResult(r));
        // It must name the remedy, not just the symptom.
        assert.match(r.stderr, /yarn turbo run build/, describeResult(r));
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /Architecture is compliant/,
          "a linter that never ran must never report compliance",
        );
      } finally {
        await cleanup(dir);
      }
    });

    it("still exits 0 and reports what it checked when the tree is compliant", async () => {
      const root = await createFixture(BASE_FILES);
      try {
        const r = await run(LAUNCHER, ["--root", root], root);
        assert.equal(r.code, 0, describeResult(r));
        assert.match(r.stdout, /Architecture is compliant/, describeResult(r));
      } finally {
        await cleanup(root);
      }
    });

    it("exits 1 — NOT 2 — when it ran fine and found violations", async () => {
      const root = await createFixture({
        ...BASE_FILES,
        "packages/billing/src/domain/violator.ts": VIOLATING_SOURCE,
      });
      try {
        const r = await run(LAUNCHER, ["--root", root], root);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(r.stderr, /Boundary Violation/, describeResult(r));
      } finally {
        await cleanup(root);
      }
    });

    it("exits 2 when the linter ran but could not load what it needs (no manifest)", async () => {
      const root = await createFixture({
        "package.json": BASE_FILES["package.json"]!,
        "tsconfig.base.json": BASE_FILES["tsconfig.base.json"]!,
      });
      try {
        const r = await run(LAUNCHER, ["--root", root], root);
        assert.equal(r.code, 2, describeResult(r));
        assert.match(
          r.stderr,
          /FATAL ERROR: Architecture manifest not found/,
          describeResult(r),
        );
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /Architecture is compliant/,
          describeResult(r),
        );
      } finally {
        await cleanup(root);
      }
    });
  },
);
