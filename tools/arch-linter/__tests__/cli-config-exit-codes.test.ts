/**
 * Exit-code contract for the linter's optional-config loading.
 *
 * The classification itself is unit-tested in `optional-yaml-config.test.ts`.
 * This suite exists because the DEFECT was an exit code: a malformed
 * `layer-rules.yaml` / `linter-config.yaml` used to fall back to defaults, and
 * the linter then printed "Architecture is compliant" and exited **0** while
 * the rules that file declared went unenforced. A classifier that is right but
 * mis-wired to `process.exit` would reproduce that bug with every unit test
 * still green, so these cases spawn the real built bin and assert on the code
 * the process actually returns.
 *
 * The headline case is `masks a real violation`: the SAME fixture, the SAME
 * violating import, one corrupt line in the config — previously exit 0
 * "compliant", now a fatal.
 *
 * Runs the built `dist/cli.js` (turbo wires this package's `test` to its own
 * `build`), because that is the artifact the `hexagen-lint` bin points at.
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

const SKIP_NON_POSIX = false; // PROBE(explore/win32-unskip): run everything on Windows to see what breaks

const MANIFEST = `system: acme-app
scope: acme
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
`;

/**
 * A `linter-config.yaml` whose `cannot_import` denial is the ONLY thing that
 * makes the fixture's import illegal — the manifest's `depends_on` grants it,
 * and an explicit denial beats a manifest grant. Lose this file's contents and
 * the violation disappears.
 */
const DENYING_CONFIG = `package_rules:
  - name: billing
    cannot_import:
      - orders
`;

const MALFORMED = `${DENYING_CONFIG}  bad: [unclosed
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
        // A non-numeric code means the process never ran to completion
        // (spawn failure, timeout, signal). Rejecting keeps such a case from
        // satisfying a `notEqual(code, 0)` assertion without proving anything.
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
 * symlink, and ts-morph reports realpaths — an unresolved root would silently
 * match zero source files and every violation assertion would vacuously pass.
 */
async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "hexagen-lint-config-"),
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
  // billing imports orders. Legal per the manifest's depends_on; illegal only
  // when linter-config.yaml's cannot_import denial is actually in force.
  await write(
    "packages/billing/src/domain/violator.ts",
    `import { x } from "@acme/orders";\nexport const y = x;\n`,
  );
  await write("packages/orders/src/index.ts", `export const x = 1;\n`);
  await fs.mkdir(path.join(root, ".architecture", "invariants"), {
    recursive: true,
  });

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

const LAYER_RULES = ".architecture/invariants/layer-rules.yaml";
const LINTER_CONFIG = ".architecture/invariants/linter-config.yaml";

describe(
  "hexagen-lint — optional config loading exit codes",
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

    it("a malformed linter-config.yaml is FATAL — it must not silently mask a real violation", async () => {
      // Baseline: with the config intact the denial fires and the run fails
      // with a Boundary Violation.
      const ok = await createFixture({ [LINTER_CONFIG]: DENYING_CONFIG });
      try {
        const r = await runLinter(ok);
        assert.equal(r.code, 1, describeResult(r));
        assert.match(r.stderr, /Boundary Violation/, describeResult(r));
      } finally {
        await cleanup(ok);
      }

      // Same project, same import, one corrupt line appended. This used to
      // print "Architecture is compliant" and exit 0.
      const broken = await createFixture({ [LINTER_CONFIG]: MALFORMED });
      try {
        const r = await runLinter(broken);
        assert.notEqual(r.code, 0, describeResult(r));
        assert.match(
          r.stderr,
          /FATAL ERROR: linter-config\.yaml exists but could not be loaded/,
          describeResult(r),
        );
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /Architecture is compliant/,
          "a config that could not be parsed must never report compliance",
        );
      } finally {
        await cleanup(broken);
      }
    });

    it("a malformed layer-rules.yaml is FATAL", async () => {
      const root = await createFixture({
        [LAYER_RULES]:
          "layers:\n  domain:\n    access_rule: strict\n bad: [x\n",
      });
      try {
        const r = await runLinter(root);
        assert.notEqual(r.code, 0, describeResult(r));
        assert.match(
          r.stderr,
          /FATAL ERROR: layer-rules\.yaml exists but could not be loaded/,
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

    it("MISSING config files still warn and fall back to defaults (exit 0)", async () => {
      const root = await createFixture({});
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 0, describeResult(r));
        // The original warning text is preserved — absent is not an error.
        assert.match(
          r.stdout + r.stderr,
          /Could not load layer-rules\.yaml from .*, using defaults/,
          describeResult(r),
        );
        assert.match(
          r.stdout + r.stderr,
          /Could not load linter-config\.yaml from .*, using defaults/,
          describeResult(r),
        );
        assert.match(
          r.stdout + r.stderr,
          /Architecture is compliant/,
          describeResult(r),
        );
      } finally {
        await cleanup(root);
      }
    });

    it("EMPTY-but-valid config files are a legitimate empty config, not a fatal", async () => {
      const root = await createFixture({
        [LAYER_RULES]: "",
        [LINTER_CONFIG]: "# no rules declared\n",
      });
      try {
        const r = await runLinter(root);
        assert.equal(r.code, 0, describeResult(r));
        assert.doesNotMatch(
          r.stdout + r.stderr,
          /FATAL ERROR/,
          "an empty config parses cleanly and must not be fatal",
        );
        assert.match(
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
