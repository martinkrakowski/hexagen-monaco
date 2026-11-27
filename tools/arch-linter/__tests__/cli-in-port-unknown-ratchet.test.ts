/**
 * `in-port-unknown` end to end — exit codes and the ratchet (D4, lane H4).
 *
 * These cases spawn the real built bin, because the contract is an EXIT CODE:
 * a fresh `in-port-unknown` finding fails the run (1), a baselined one is
 * suppressed (0), a stale entry warns without failing (0), and a corrupted
 * baseline is FATAL (2) — the same vocabulary as every other ratcheted rule.
 * Unit tests of the predicate could be green while cli.ts never called it;
 * these cases pin the wiring.
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

/** The offending in-port: an exported interface method typed `unknown`. */
const VIOLATING_PORT = {
  "packages/billing/src/application/ports/in/charge.port.ts":
    `export interface ChargePort { charge(req: unknown): Promise<void>; }\n`,
};

/** Same file, typed — what the port looks like after the fix lands. */
const TYPED_PORT = {
  "packages/billing/src/application/ports/in/charge.port.ts":
    `export interface ChargePort { charge(req: { orderId: string }): Promise<void>; }\n`,
};

/** The baseline key the linter emits for VIOLATING_PORT. */
const BASELINE_ENTRY =
  '{"rule":"in-port-unknown","file":"packages/billing/src/application/ports/in/charge.port.ts","specifier":"ChargePort.charge:req"}';

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
        // A non-numeric code means the process never ran to completion (spawn
        // failure, timeout, signal) — reject rather than let `notEqual(0)`
        // pass vacuously.
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
    path.join(await fs.realpath(os.tmpdir()), "hexagen-lint-inport-"),
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
  // Always present, always legal: the rest of the context produces no
  // findings, so every assertion below is attributable to the port file.
  await write(
    "packages/billing/src/domain/model/money.ts",
    `export const money = 1;\n`,
  );
  await write(
    "packages/billing/src/application/charge.use-case.ts",
    `import { money } from "../domain/model/money.js";\nexport const charge = money;\n`,
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

describe("hexagen-lint — in-port-unknown ratchet (D4)", () => {
  beforeAll(async () => {
    assert.ok(
      await fs
        .stat(CLI)
        .then(() => true)
        .catch(() => false),
      `missing ${CLI} — build @hexagen/arch-linter before running this suite`,
    );
  });

  it("exits 1 on an unbaselined in-port-unknown violation", async () => {
    await withFixture(VIOLATING_PORT, async (root) => {
      const r = await runLinter(root);
      assert.equal(r.code, 1, describeResult(r));
      // The finding is named: rule, specifier and the port file.
      assert.match(
        r.stderr,
        /in-port 'ChargePort' accepts 'unknown'[\s\S]*charge\.port\.ts/,
        describeResult(r),
      );
      assert.match(
        r.stdout + r.stderr,
        /Ratchet: 0 suppressed \/ 0 stale \/ 1 fresh/,
        describeResult(r),
      );
      assert.doesNotMatch(
        r.stdout + r.stderr,
        /Architecture is compliant/,
        describeResult(r),
      );
    });
  });

  it("suppresses a baselined in-port-unknown violation and exits 0", async () => {
    await withFixture(VIOLATING_PORT, async (root) => {
      // Seed the baseline from the current state…
      const seed = await runLinter(root, "--update-baseline");
      assert.equal(seed.code, 0, describeResult(seed));
      const baseline = JSON.parse(
        await fs.readFile(path.join(root, BASELINE_PATH), "utf8"),
      );
      const entry = baseline.entries.find(
        (e: { rule: string }) => e.rule === "in-port-unknown",
      );
      assert.ok(entry, `no in-port-unknown entry seeded: ${JSON.stringify(baseline)}`);
      assert.equal(
        entry.file,
        "packages/billing/src/application/ports/in/charge.port.ts",
      );
      assert.equal(entry.specifier, "ChargePort.charge:req");

      // …and the same tree is now green.
      const green = await runLinter(root);
      assert.equal(green.code, 0, describeResult(green));
      assert.match(
        green.stdout + green.stderr,
        /Ratchet: 1 suppressed \/ 0 stale \/ 0 fresh/,
        describeResult(green),
      );
      assert.match(
        green.stdout + green.stderr,
        /Architecture is compliant/,
        describeResult(green),
      );
    });
  });

  it("warns on a stale in-port-unknown baseline entry after the port is typed and exits 0", async () => {
    // The port has been fixed (typed request) but its baseline entry survived.
    await withFixture(
      {
        ...TYPED_PORT,
        [BASELINE_PATH]: `{"version":1,"entries":[${BASELINE_ENTRY}]}`,
      },
      async (root) => {
        const r = await runLinter(root);
        assert.equal(r.code, 0, describeResult(r));
        assert.match(
          r.stdout + r.stderr,
          /Ratchet: 0 suppressed \/ 1 stale \/ 0 fresh/,
          describeResult(r),
        );
        assert.match(
          r.stdout + r.stderr,
          /1 baseline entry no longer reproduces/,
          describeResult(r),
        );
        // The stale entry is named so the PR that fixed the port deletes its
        // own entry (ADR-0054 §1 review-enforced burn-down).
        assert.match(r.stdout + r.stderr, /charge\.port\.ts/, describeResult(r));
        assert.match(
          r.stdout + r.stderr,
          /Architecture is compliant/,
          describeResult(r),
        );
      },
    );
  });

  it("exits 2 when the arch-lint baseline is corrupted", async () => {
    await withFixture(
      {
        ...VIOLATING_PORT,
        [BASELINE_PATH]: `{"version":1,"entries":[{"rule":"in-port-unknown",`,
      },
      async (root) => {
        const r = await runLinter(root);
        assert.equal(r.code, 2, describeResult(r));
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
});
