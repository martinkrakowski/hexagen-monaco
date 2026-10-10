/**
 * LINT-1 — a co-located test file is outside `node-builtin-in-layer` and
 * `npm-package-in-domain`, and nothing else.
 *
 * Since 0.11.0 those two rules flag imports in domain (and, for the builtin
 * rule, application) files. Files under `__tests__/` were skipped by
 * `isTestDoubleOrTest`, but a co-located `foo.test.ts` in a domain folder was
 * not: a project that keeps its tests beside the code got a finding per test
 * file. Every other rule (layer-import, cross-package, …) still applies to such
 * a file, so the exemption is deliberately narrow.
 *
 * These cases spawn the real built bin, because the defect is an exit code and
 * a finding, not a predicate. Runs `dist/cli.js` (turbo wires this package's
 * `test` to its own `build`).
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
      infrastructure: {}
`;

const LAYER_RULES = `layers:
  domain:
    access_rule: internal-only
    allowed_imports: ["@acme/shared"]
  application:
    access_rule: ports-only
    allowed_imports: ["domain", "@acme/shared"]
  infrastructure:
    access_rule: adapters
    allowed_imports: ["domain", "application", "@acme/shared"]
`;

const LAYER_RULES_PATH = ".architecture/invariants/layer-rules.yaml";
const LINTER_CONFIG_PATH = ".architecture/invariants/linter-config.yaml";

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

/**
 * A minimal lintable project. `realpath` matters: on macOS `os.tmpdir()` is a
 * symlink and ts-morph reports realpaths — an unresolved root would match zero
 * source files and every violation assertion would vacuously pass.
 */
async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "hexagen-lint-colocated-"),
  );
  const write = async (rel: string, contents: string) => {
    const target = path.join(root, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  };

  await write(".architecture/manifest.yaml", MANIFEST);
  await write(LAYER_RULES_PATH, LAYER_RULES);
  await write(LINTER_CONFIG_PATH, "# no rules declared\n");
  await write(
    "tsconfig.base.json",
    `{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true } }\n`,
  );
  await write(
    "package.json",
    `{ "name": "fixture-root", "private": true, "workspaces": ["packages/*"] }\n`,
  );
  await write(
    "packages/billing/src/infrastructure/db.adapter.ts",
    `import fs from "node:fs";\nexport const db = fs;\n`,
  );

  for (const [rel, contents] of Object.entries(files)) {
    await write(rel, contents);
  }
  return root;
}

async function withFixture(
  files: Record<string, string>,
  body: (root: string) => Promise<void>,
): Promise<void> {
  const root = await createFixture(files);
  try {
    await body(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A co-located test file whose name is the suffix under test. */
function testFileBody(name: string): string {
  return `import { describe, it } from "vitest";\nimport assert from "node:assert/strict";\nimport { thing } from "./thing.js";\n\ndescribe("${name}", () => {\n  it("works", () => {\n    assert.equal(thing, 1);\n  });\n});\n`;
}

describe("hexagen-lint — co-located test files", () => {
  beforeAll(async () => {
    assert.ok(
      await fs
        .stat(CLI)
        .then(() => true)
        .catch(() => false),
      `missing ${CLI} — build @hexagen/arch-linter before running this suite`,
    );
  });

  it("a co-located domain test file may import vitest and node:assert/strict", async () => {
    await withFixture(
      {
        "packages/billing/src/domain/model/thing.ts": `export const thing = 1;\n`,
        "packages/billing/src/domain/model/thing.test.ts":
          testFileBody("thing.test"),
      },
      async (root) => {
        const r = await runLinter(root);
        assert.equal(r.code, 0, describeResult(r));
        assert.match(r.stdout + r.stderr, /Architecture is compliant/);
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /node-builtin-in-layer|npm-package-in-domain/,
          describeResult(r),
        );
      },
    );
  });

  it("the same holds for a co-located .spec.ts file", async () => {
    await withFixture(
      {
        "packages/billing/src/domain/model/thing.ts": `export const thing = 1;\n`,
        "packages/billing/src/domain/model/thing.spec.ts":
          testFileBody("thing.spec"),
      },
      async (root) => {
        const r = await runLinter(root);
        assert.equal(r.code, 0, describeResult(r));
        assert.match(r.stdout + r.stderr, /Architecture is compliant/);
      },
    );
  });

  it("a production domain file importing node:assert/strict is still a finding", async () => {
    await withFixture(
      {
        "packages/billing/src/domain/model/thing.ts": `import assert from "node:assert/strict";\nexport const thing = assert;\n`,
      },
      async (root) => {
        const r = await runLinter(root);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(
          r.stderr,
          /Node builtin 'node:assert\/strict' imported in the 'domain' layer/,
          describeResult(r),
        );
      },
    );
  });

  it("a production domain file importing vitest is still a finding", async () => {
    await withFixture(
      {
        "packages/billing/src/domain/model/thing.ts": `import { it } from "vitest";\nexport const thing = it;\n`,
      },
      async (root) => {
        const r = await runLinter(root);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(
          r.stderr,
          /npm package 'vitest' imported in the domain layer/,
          describeResult(r),
        );
      },
    );
  });

  it("a co-located test file is still held to the other rules", async () => {
    // The exemption is exactly the two layer-purity rules. This file is a
    // co-located domain test AND it imports out of the domain layer, which
    // `domain-layer-import` must still report.
    await withFixture(
      {
        "packages/billing/src/domain/model/thing.ts": `export const thing = 1;\n`,
        "packages/billing/src/domain/model/thing.test.ts": `import { db } from "../../infrastructure/db.adapter.js";\nimport { thing } from "./thing.js";\nexport const seen = [db, thing];\n`,
      },
      async (root) => {
        const r = await runLinter(root);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(
          r.stderr,
          /Relative import '\.\.\/\.\.\/infrastructure\/db\.adapter\.js' crosses out of the 'domain' layer into 'infrastructure'/,
          describeResult(r),
        );
      },
    );
  });
});
