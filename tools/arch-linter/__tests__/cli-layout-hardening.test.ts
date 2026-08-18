/**
 * Phase 0.1 DoD — foreign-repo linter hardening, end to end against dist/cli.js.
 *
 * (a) exit 2 + clear message on zero files scanned
 * (b) files-scanned count reported
 * (c) purity dispatch works via layout.yaml on a core/services repo
 * (d) no ts-morph crash on plain tsconfig.json
 * (e) misspelled layout.yaml mapping fails loudly
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
      application: {}
`;

const CORE_SERVICES_LAYOUT = `contexts:
  billing:
    root: packages/billing
    layers:
      domain: [src/core]
      application: [src/services]
`;

const TSCONFIG = `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true } }\n`;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runLinter(root: string, ...args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI, "--root", root, ...args],
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
    "package.json",
    `{ "name": "fixture-root", "private": true, "workspaces": ["packages/*"] }\n`,
  );

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
  "hexagen-lint — layout.yaml + foreign-repo hardening",
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

    it("(a) exits 2 with a clear message when zero resolvable files were scanned", async () => {
      const root = await createFixture({
        "tsconfig.json": TSCONFIG,
        // Context declared, directory missing — generated repos do this.
        // Vacuity is zero files scanned, not "missing dir is fatal".
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 2, describeResult(r));
        assert.match(
          r.stdout + r.stderr,
          /zero resolvable (source )?files/i,
          describeResult(r),
        );
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /Architecture is compliant/,
          "a vacuous run must never report compliance",
        );
      } finally {
        await cleanup(root);
      }
    });

    it("(b) reports the files-scanned count on a non-vacuous run", async () => {
      const root = await createFixture({
        "tsconfig.json": TSCONFIG,
        "packages/billing/src/domain/model.ts": `export const x = 1;\n`,
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 0, describeResult(r));
        assert.match(
          r.stdout + r.stderr,
          /files scanned:\s*[1-9]\d*/i,
          describeResult(r),
        );
      } finally {
        await cleanup(root);
      }
    });

    it("(c) purity-check layer dispatch works via layout.yaml on a core/services repo", async () => {
      const root = await createFixture({
        "tsconfig.json": TSCONFIG,
        ".architecture/layout.yaml": CORE_SERVICES_LAYOUT,
        // node:fs in src/core must fire as a domain purity violation even
        // though the path has no /domain/ segment.
        "packages/billing/src/core/invoice.ts": `import fs from "node:fs";\nexport const invoice = fs;\n`,
        "packages/billing/src/services/charge.ts": `export const charge = 1;\n`,
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(
          r.stdout + r.stderr,
          /node-builtin-in-layer|Node builtin/,
          describeResult(r),
        );
        assert.match(r.stdout + r.stderr, /domain/i, describeResult(r));
      } finally {
        await cleanup(root);
      }
    });

    it("(d) does not crash on a plain tsconfig.json (no tsconfig.base.json)", async () => {
      const root = await createFixture({
        "tsconfig.json": TSCONFIG,
        "packages/billing/src/domain/model.ts": `export const x = 1;\n`,
      });
      try {
        const r = await runLinter(root);
        assert.notEqual(r.code, 2, describeResult(r));
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /tsconfig\.base\.json/,
          "must not demand tsconfig.base.json when tsconfig.json exists",
        );
        assert.doesNotMatch(
          r.stderr,
          /ENOENT|Cannot find|tsconfig.*not found/i,
          describeResult(r),
        );
      } finally {
        await cleanup(root);
      }
    });

    it("(e) a misspelled layout.yaml mapping fails loudly (exit 2)", async () => {
      const root = await createFixture({
        "tsconfig.json": TSCONFIG,
        ".architecture/layout.yaml": `contexts:
  billing:
    rooot: packages/billing
    layers:
      domaine: [src/core]
`,
        "packages/billing/src/core/invoice.ts": `export const invoice = 1;\n`,
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 2, describeResult(r));
        assert.match(
          r.stdout + r.stderr,
          /layout\.yaml|FATAL ERROR/i,
          describeResult(r),
        );
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /Architecture is compliant/,
          "an invalid layout must never report compliance",
        );
      } finally {
        await cleanup(root);
      }
    });

    it("does not report npm-package-in-domain for an extra-scope workspace import", async () => {
      // Manifest scope is @acme-app; workspace packages live under @acme.
      // After adopt/bootstrap this is the common shape. depends_on grants the
      // edge; the npm-package check must not fire on the extra scope.
      const root = await createFixture({
        "tsconfig.json": TSCONFIG,
        ".architecture/manifest.yaml": `system: acme-app
scope: acme-app
architecture: modular-monolith
bounded_contexts:
  - name: billing
    type: core
    description: Billing
    depends_on: [orders]
    layers:
      domain: {}
  - name: orders
    type: core
    description: Orders
    layers:
      domain: {}
`,
        ".architecture/layout.yaml": `contexts:
  billing:
    root: packages/billing
    layers:
      domain: [src/core]
  orders:
    root: packages/orders
    layers:
      domain: [src/core]
`,
        "packages/billing/package.json": `{ "name": "@acme/billing" }\n`,
        "packages/orders/package.json": `{ "name": "@acme/orders" }\n`,
        "packages/billing/src/core/invoice.ts": `import { x } from "@acme/orders";\nexport const invoice = x;\n`,
        "packages/orders/src/core/index.ts": `export const x = 1;\n`,
      });
      try {
        const r = await runLinter(root);
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /npm-package-in-domain|npm package '@acme\/orders'/,
          describeResult(r),
        );
      } finally {
        await cleanup(root);
      }
    });

    it('does not treat import "zod" as a cross-package import when a context is named zod', async () => {
      const root = await createFixture({
        "tsconfig.json": TSCONFIG,
        ".architecture/manifest.yaml": `system: acme-app
scope: acme
architecture: modular-monolith
bounded_contexts:
  - name: billing
    type: core
    description: Billing
    layers:
      domain: {}
  - name: zod
    type: core
    description: Zod context
    layers:
      domain: {}
`,
        "packages/billing/src/domain/model.ts": `import { z } from "zod";\nexport const schema = z;\n`,
        "packages/zod/src/domain/index.ts": `export const local = 1;\n`,
      });
      try {
        const r = await runLinter(root);
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /Boundary Violation|cross-package-import/,
          describeResult(r),
        );
      } finally {
        await cleanup(root);
      }
    });
  },
);
