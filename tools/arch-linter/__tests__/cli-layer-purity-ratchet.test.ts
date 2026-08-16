/**
 * AUD-011 (ADR-0054 §2) — the three layer-rule holes, end to end, plus the
 * ratchet that decides which findings fail the run (ADR-0054 §1).
 *
 * These cases spawn the real built bin, because the DEFECT was an exit code:
 * every fixture below used to print "Architecture is compliant" and exit **0**.
 * A unit test of the new predicates could be perfectly green while the CLI
 * never called them — which is exactly the shape of the blind spot being fixed
 * (the old checks were gated on `getModuleSpecifierSourceFile()`, so a builtin
 * or an npm package produced no finding no matter how right the policy was).
 *
 * Every "flags …" case is paired with a legality case in the SAME fixture
 * shape, so a rule that simply fired on everything would fail the suite too.
 *
 * Runs `dist/cli.js` (turbo wires this package's `test` to its own `build`).
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
const BASELINE_PATH = ".architecture/arch-lint-baseline.json";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runLinterFrom(
  cwd: string,
  root: string,
  ...args: string[]
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI, "--root", root, ...args],
      { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // A non-numeric code means the process never ran to completion (spawn
        // failure, timeout, signal) — rejecting keeps such a case from
        // satisfying `notEqual(code, 0)` without proving anything.
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

/** The common case: cwd IS the project root. */
function runLinter(root: string, ...args: string[]): Promise<RunResult> {
  return runLinterFrom(root, root, ...args);
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
    path.join(await fs.realpath(os.tmpdir()), "hexagen-lint-purity-"),
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
  // Always present, always legal: a same-layer relative import and a
  // cross-layer relative import the layer rules explicitly allow. If a rule
  // over-fires, these turn the "legal" cases red.
  await write(
    "packages/billing/src/domain/model/money.ts",
    `export const money = 1;\n`,
  );
  await write(
    "packages/billing/src/domain/model/invoice.ts",
    `import { money } from "./money.js";\nexport const invoice = money;\n`,
  );
  await write(
    "packages/billing/src/application/charge.use-case.ts",
    `import { invoice } from "../domain/model/invoice.js";\nexport const charge = invoice;\n`,
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

async function cleanup(root: string): Promise<void> {
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch (err) {
    console.warn(`fixture cleanup failed (${root}):`, err);
  }
}

async function withFixture(
  files: Record<string, string>,
  body: (root: string) => Promise<void>,
): Promise<void> {
  const root = await createFixture(files);
  try {
    await body(root);
  } finally {
    await cleanup(root);
  }
}

describe(
  "hexagen-lint — layer purity (AUD-011)",
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

    it("the always-present legal fixture is compliant (no rule over-fires)", async () => {
      await withFixture({}, async (root) => {
        const r = await runLinter(root);
        assert.equal(r.code, 0, describeResult(r));
        assert.match(r.stdout + r.stderr, /Architecture is compliant/);
      });
    });

    it("hole 1 — a relative import that crosses OUT of the domain layer fails", async () => {
      await withFixture(
        {
          "packages/billing/src/domain/model/ledger.ts": `import { db } from "../../infrastructure/db.adapter.js";\nexport const ledger = db;\n`,
        },
        async (root) => {
          const r = await runLinter(root);
          assert.equal(r.code, 1, describeResult(r));
          assert.match(
            r.stderr,
            /Relative import '\.\.\/\.\.\/infrastructure\/db\.adapter\.js' crosses out of the 'domain' layer into 'infrastructure'/,
            describeResult(r),
          );
          assert.doesNotMatch(
            r.stdout + r.stderr,
            /Architecture is compliant/,
            describeResult(r),
          );
        },
      );
    });

    it("hole 1 — the application layer's relative escape hatch is closed too", async () => {
      await withFixture(
        {
          "packages/billing/src/application/report.use-case.ts": `import { db } from "../infrastructure/db.adapter.js";\nexport const report = db;\n`,
        },
        async (root) => {
          const r = await runLinter(root);
          assert.equal(r.code, 1, describeResult(r));
          assert.match(
            r.stderr,
            /Application Violation[\s\S]*crosses out of the 'application' layer into 'infrastructure'/,
            describeResult(r),
          );
        },
      );
    });

    it("hole 2 — node builtins in domain and in application both fail", async () => {
      await withFixture(
        {
          "packages/billing/src/domain/model/statement.ts": `import fs from "node:fs/promises";\nexport const statement = fs;\n`,
          "packages/billing/src/application/export.use-case.ts": `import path from "path";\nexport const exporter = path;\n`,
        },
        async (root) => {
          const r = await runLinter(root);
          assert.equal(r.code, 1, describeResult(r));
          assert.match(
            r.stderr,
            /Node builtin 'node:fs\/promises' imported in the 'domain' layer/,
            describeResult(r),
          );
          // Bare builtin names (no `node:` prefix) count as builtins too.
          assert.match(
            r.stderr,
            /Node builtin 'path' imported in the 'application' layer/,
            describeResult(r),
          );
          // …and the infrastructure adapter's own `node:fs` import stays legal.
          assert.doesNotMatch(
            r.stderr,
            /db\.adapter\.ts/,
            "the builtin ban is domain/application only",
          );
        },
      );
    });

    it("hole 3 — an npm package in domain fails, and the allowlist releases it", async () => {
      const domainFile = {
        "packages/billing/src/domain/model/config.ts": `import yaml from "js-yaml";\nexport const config = yaml;\n`,
      };

      await withFixture(domainFile, async (root) => {
        const r = await runLinter(root);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(
          r.stderr,
          /npm package 'js-yaml' imported in the domain layer/,
          describeResult(r),
        );
      });

      // Same file, same import, one declarative exception — the HEX-026 shape.
      await withFixture(
        {
          ...domainFile,
          [LINTER_CONFIG_PATH]: `domain_package_allowlist:\n  - package: billing\n    allowed_packages: [js-yaml]\n`,
        },
        async (root) => {
          const r = await runLinter(root);
          assert.equal(r.code, 0, describeResult(r));
          assert.match(r.stdout + r.stderr, /Architecture is compliant/);
        },
      );
    });

    it("hole 3 — the allowlist is per-context, not global", async () => {
      await withFixture(
        {
          "packages/billing/src/domain/model/config.ts": `import yaml from "js-yaml";\nexport const config = yaml;\n`,
          // The exception is granted to a DIFFERENT context.
          [LINTER_CONFIG_PATH]: `domain_package_allowlist:\n  - package: shipping\n    allowed_packages: [js-yaml]\n`,
        },
        async (root) => {
          const r = await runLinter(root);
          assert.equal(r.code, 1, describeResult(r));
          assert.match(r.stderr, /npm package 'js-yaml'/, describeResult(r));
        },
      );
    });

    it("hole 3 — application-layer npm packages stay legal (ADR-0054 §2c)", async () => {
      await withFixture(
        {
          "packages/billing/src/application/render.use-case.ts": `import yaml from "js-yaml";\nexport const render = yaml;\n`,
        },
        async (root) => {
          const r = await runLinter(root);
          assert.equal(r.code, 0, describeResult(r));
        },
      );
    });

    describe("the ratchet", () => {
      const VIOLATORS = {
        "packages/billing/src/domain/model/ledger.ts": `import { db } from "../../infrastructure/db.adapter.js";\nexport const ledger = db;\n`,
        "packages/billing/src/domain/model/statement.ts": `import fs from "node:fs/promises";\nexport const statement = fs;\n`,
        "packages/billing/src/domain/model/config.ts": `import yaml from "js-yaml";\nexport const config = yaml;\n`,
      };

      it("baselined violations pass; a NEW one fails and is named alone", async () => {
        await withFixture(VIOLATORS, async (root) => {
          // Seed the baseline from the current state…
          const seed = await runLinter(root, "--update-baseline");
          assert.equal(seed.code, 0, describeResult(seed));
          const baseline = JSON.parse(
            await fs.readFile(path.join(root, BASELINE_PATH), "utf8"),
          );
          assert.equal(baseline.entries.length, 3, JSON.stringify(baseline));

          // …and the same tree is now green.
          const green = await runLinter(root);
          assert.equal(green.code, 0, describeResult(green));
          assert.match(
            green.stdout + green.stderr,
            /Ratchet: 3 known violation\(s\) suppressed/,
            describeResult(green),
          );

          // One NEW violation, nothing else changed.
          await fs.writeFile(
            path.join(root, "packages/billing/src/domain/model/clock.ts"),
            `import os from "node:os";\nexport const clock = os;\n`,
            "utf8",
          );
          const red = await runLinter(root);
          assert.equal(red.code, 1, describeResult(red));
          assert.match(red.stderr, /clock\.ts/, describeResult(red));
          assert.match(
            red.stderr,
            /These are NEW violations, measured against the committed baseline/,
            describeResult(red),
          );
          // The three baselined findings must NOT be re-reported as failures.
          assert.doesNotMatch(red.stderr, /ledger\.ts/, describeResult(red));
          assert.doesNotMatch(red.stderr, /js-yaml/, describeResult(red));
        });
      });

      it("a baseline entry that no longer reproduces warns, and does not fail", async () => {
        await withFixture(
          {
            [BASELINE_PATH]: `{"version":1,"entries":[{"rule":"npm-package-in-domain","file":"packages/billing/src/domain/model/gone.ts","specifier":"js-yaml"}]}`,
          },
          async (root) => {
            const r = await runLinter(root);
            assert.equal(r.code, 0, describeResult(r));
            assert.match(
              r.stdout + r.stderr,
              /1 baseline entry no longer reproduces/,
              describeResult(r),
            );
            assert.match(r.stdout + r.stderr, /gone\.ts/, describeResult(r));
          },
        );
      });

      it("a malformed baseline is FATAL — it must not silently change what is enforced", async () => {
        await withFixture(
          {
            ...VIOLATORS,
            [BASELINE_PATH]: `{"version":1,"entries":[{"rule":`,
          },
          async (root) => {
            const r = await runLinter(root);
            assert.notEqual(r.code, 0, describeResult(r));
            assert.match(
              r.stderr,
              /FATAL ERROR: arch-lint baseline exists but could not be loaded/,
              describeResult(r),
            );
            assert.doesNotMatch(
              r.stdout + r.stderr,
              /Architecture is compliant/,
              describeResult(r),
            );
          },
        );
      });

      it("--update-baseline is deterministic and one entry per line", async () => {
        await withFixture(VIOLATORS, async (root) => {
          await runLinter(root, "--update-baseline");
          const first = await fs.readFile(
            path.join(root, BASELINE_PATH),
            "utf8",
          );
          await runLinter(root, "--update-baseline");
          const second = await fs.readFile(
            path.join(root, BASELINE_PATH),
            "utf8",
          );
          assert.equal(second, first, "baseline writing must be byte-stable");

          const entryLines = first
            .split("\n")
            .filter((line) => line.trim().startsWith('{"rule"'));
          assert.equal(entryLines.length, 3, first);
          for (const line of entryLines) {
            // Each line parses on its own → a fixed violation is a one-line diff.
            JSON.parse(line.trim().replace(/,$/, ""));
          }
        });
      });

      // `--root` exists precisely so the linter can be pointed at a project the
      // caller is NOT standing in. A `--baseline` resolved against cwd would
      // then read/write a file beside the caller instead of inside that
      // project — enforcing against an absent baseline (everything fails) or
      // scattering baselines into unrelated directories.
      it("a relative --baseline resolves from the project root, not cwd", async () => {
        await withFixture(VIOLATORS, async (root) => {
          // A fresh empty dir, so "nothing landed here" is a real assertion.
          const elsewhere = await fs.mkdtemp(
            path.join(await fs.realpath(os.tmpdir()), "hexagen-lint-cwd-"),
          );
          const seed = await runLinterFrom(
            elsewhere,
            root,
            "--baseline",
            "ci/arch-lint-baseline.json",
            "--update-baseline",
          );
          assert.equal(seed.code, 0, describeResult(seed));

          const written = path.join(root, "ci", "arch-lint-baseline.json");
          const baseline = JSON.parse(await fs.readFile(written, "utf8"));
          assert.equal(baseline.entries.length, 3, JSON.stringify(baseline));
          // Nothing was written next to the caller.
          await assert.rejects(
            () => fs.access(path.join(elsewhere, "ci")),
            "the baseline must not land beside cwd",
          );

          // …and enforcement reads back the same file from the same cwd.
          const green = await runLinterFrom(
            elsewhere,
            root,
            "--baseline",
            "ci/arch-lint-baseline.json",
          );
          assert.equal(green.code, 0, describeResult(green));
          assert.match(
            green.stdout + green.stderr,
            /Ratchet: 3 known violation\(s\) suppressed/,
            describeResult(green),
          );
          await cleanup(elsewhere);
        });
      });

      it("an absolute --baseline is honoured as given", async () => {
        await withFixture(VIOLATORS, async (root) => {
          const abs = path.join(root, "ci", "abs-baseline.json");
          const seed = await runLinterFrom(
            await fs.realpath(os.tmpdir()),
            root,
            "--baseline",
            abs,
            "--update-baseline",
          );
          assert.equal(seed.code, 0, describeResult(seed));
          const baseline = JSON.parse(await fs.readFile(abs, "utf8"));
          assert.equal(baseline.entries.length, 3, JSON.stringify(baseline));
        });
      });

      it("--baseline with no value is FATAL, not a silent fall back to the default", async () => {
        await withFixture(VIOLATORS, async (root) => {
          const r = await runLinter(root, "--baseline");
          assert.notEqual(r.code, 0, describeResult(r));
          assert.match(
            r.stderr,
            /FATAL ERROR: --baseline requires a path argument/,
            describeResult(r),
          );
          // A following flag is a missing value too, not a filename.
          const flagAsValue = await runLinter(
            root,
            "--baseline",
            "--update-baseline",
          );
          assert.notEqual(flagAsValue.code, 0, describeResult(flagAsValue));
          assert.match(
            flagAsValue.stderr,
            /FATAL ERROR: --baseline requires a path argument/,
            describeResult(flagAsValue),
          );
          await assert.rejects(
            () => fs.access(path.join(root, "--update-baseline")),
            "a flag must never be taken as a baseline filename",
          );
        });
      });
    });
  },
);
