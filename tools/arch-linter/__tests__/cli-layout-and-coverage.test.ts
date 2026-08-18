/**
 * Layout contract + per-module anti-vacuity, run against the built CLI.
 *
 * These cases used to go green: `layers: domain` became the character "d",
 * a module directory with no matched sources was skipped, and unscoped
 * workspace imports never reached the boundary checker.
 */
import { describe, it, beforeAll } from "vitest";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "dist", "cli.js");
const SKIP_NON_POSIX = process.platform === "win32";

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

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runLinter(root: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI, "--root", root],
      { cwd: root, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(
            new Error(
              `linter did not exit on its own (${error.code ?? error.signal ?? error.message})`,
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

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "hexagen-lint-layout-"),
  );
  const write = async (rel: string, contents: string) => {
    const target = path.join(root, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  };

  await write(".architecture/manifest.yaml", MANIFEST);
  await write(
    "tsconfig.base.json",
    `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true } }\n`,
  );
  await write(
    "package.json",
    `{ "name": "fixture-root", "private": true, "workspaces": ["packages/*"] }\n`,
  );
  await write("packages/orders/src/index.ts", `export const x = 1;\n`);

  for (const [rel, contents] of Object.entries(files)) {
    await write(rel, contents);
  }
  return root;
}

async function cleanup(root: string): Promise<void> {
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch (err) {
    console.warn(`fixture cleanup failed (${root}):`, err);
  }
}

describe(
  "hexagen-lint — layout.yaml contract and per-module coverage",
  { skip: SKIP_NON_POSIX },
  () => {
    beforeAll(async () => {
      assert.ok(
        await fs
          .stat(CLI)
          .then(() => true)
          .catch(() => false),
        `missing ${CLI} — build @hexagen/arch-linter before running this suite`,
      );
    });

    it("rejects a scalar layers value with exit 2", async () => {
      const root = await createFixture({
        "packages/billing/src/domain/index.ts": `export const billing = 1;\n`,
        ".architecture/layout.yaml": "layers: domain\n",
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 2, describeResult(r));
        assert.match(r.stderr, /layers/, describeResult(r));
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /Architecture is compliant/,
          "invalid layers must never report compliance",
        );
      } finally {
        await cleanup(root);
      }
    });

    it("applies configured layer names to purity dispatch", async () => {
      const root = await createFixture({
        ".architecture/layout.yaml": "layers:\n  - core\n  - services\n",
        "packages/billing/src/core/entity.ts": `import fs from "node:fs";\nexport const entity = fs;\n`,
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(
          r.stderr,
          /node-builtin-in-layer|node:fs/,
          describeResult(r),
        );
      } finally {
        await cleanup(root);
      }
    });

    it("keeps named domain/application roles when the list is reordered", async () => {
      const root = await createFixture({
        ".architecture/layout.yaml": "layers:\n  - services\n  - domain\n",
        "packages/billing/src/domain/entity.ts": `import fs from "node:fs";\nexport const entity = fs;\n`,
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(
          r.stderr,
          /node-builtin-in-layer|node:fs/,
          describeResult(r),
        );
      } finally {
        await cleanup(root);
      }
    });

    it("fails closed when a manifest context has no directory", async () => {
      const root = await createFixture({
        "packages/billing/src/index.ts": `export const billing = 1;\n`,
        ".architecture/manifest.yaml": `system: acme-app
scope: acme
architecture: modular-monolith
bounded_contexts:
  - name: billing
    type: core
    description: Billing
    layers:
      domain: {}
  - name: ghost
    type: core
    description: Missing
    layers:
      domain: {}
`,
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 2, describeResult(r));
        assert.match(r.stderr, /does not exist/, describeResult(r));
        assert.match(r.stderr, /ghost/, describeResult(r));
      } finally {
        await cleanup(root);
      }
    });

    it("fails closed when a checked module directory matches no source files", async () => {
      const root = await createFixture({
        "packages/billing/README.md": "no typescript here\n",
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 2, describeResult(r));
        assert.match(
          r.stderr,
          /NOTHING WAS CHECKED for module 'billing'/,
          describeResult(r),
        );
      } finally {
        await cleanup(root);
      }
    });

    it("flags an undeclared unscoped workspace import", async () => {
      const root = await createFixture({
        "packages/billing/src/index.ts": `import { x } from "orders";\nexport const y = x;\n`,
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(r.stderr, /Boundary Violation/, describeResult(r));
        assert.match(r.stderr, /'orders'/, describeResult(r));
      } finally {
        await cleanup(root);
      }
    });
  },
);
