/**
 * Pins the machine-readable lines of the consumer contract (plan H2):
 * `hexagen-lint --json` and `hexagen arch validate --json`. Like the other
 * contract suites, it runs the BUILT artifacts the way a consumer runs them —
 * the copied dist/cli.js and the node_modules/.bin/hexagen-lint shim.
 */
import assert from "node:assert/strict";
import { describe, it, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  VALID_MANIFEST,
  createPublishedLayoutFixture,
  runHexagen,
  runLint,
  describeResult,
  cleanupFixture,
  assertBuiltArtifactsPresent,
  writeBinStub,
  type ContractFixture,
} from "../helpers/published-layout.js";

const FIXTURE_PREFIX = "hexagen-machine-output-contract-";

// The two-context manifest from exit-codes.contract.test.ts lines 552-566.
const TWO_CONTEXT_MANIFEST = `system: acme-app
scope: acme
architecture: modular-monolith
bounded_contexts:
  - name: shared
    type: shared-kernel
    description: Shared primitives
    layers:
      domain: {}
  - name: billing
    type: core
    description: Billing context
    layers:
      domain: {}
      application: {}
`;

// The same tsconfig.base.json as exit-codes.contract.test.ts lines 572-586,
// constraining ts-morph to the fixture's own packages.
const TSCONFIG_BASE =
  JSON.stringify(
    {
      compilerOptions: {
        target: "es2022",
        moduleResolution: "bundler",
      },
      include: ["packages/*/src/**/*.ts"],
    },
    null,
    2,
  ) + "\n";

const CLEAN = "export const x = 1;\n";
const VIOLATING =
  'import { whatever } from "@acme/orders";\nexport const x = whatever;\n';

async function lintableFixture(source: string): Promise<ContractFixture> {
  const fix = await createPublishedLayoutFixture(
    TWO_CONTEXT_MANIFEST,
    FIXTURE_PREFIX,
  );
  await fs.writeFile(
    path.join(fix.root, "tsconfig.base.json"),
    TSCONFIG_BASE,
    "utf8",
  );
  const srcDir = path.join(fix.root, "packages", "billing", "src", "domain");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "sample.ts"), source, "utf8");
  return fix;
}

function oneJsonLine(stdout: string): Record<string, unknown> {
  assert.ok(
    stdout.endsWith("\n"),
    `expected stdout to end with a newline, got ${JSON.stringify(stdout)}`,
  );
  const newlineCount = stdout.split("\n").length - 1;
  assert.equal(
    newlineCount,
    1,
    `expected exactly one newline in stdout, got ${newlineCount}:\n${stdout}`,
  );
  const line = stdout.slice(0, -1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    assert.fail(`stdout line is not valid JSON (${String(e)}): ${line}`);
  }
  assert.ok(
    typeof parsed === "object" && parsed !== null,
    `stdout line is not a JSON object: ${line}`,
  );
  return parsed as Record<string, unknown>;
}

describe("machine-readable output contract (H2)", () => {
  beforeAll(assertBuiltArtifactsPresent);

  it("hexagen-lint --json on a clean tree exits 0 with a schemaVersion 1 line", async () => {
    const fix = await lintableFixture(CLEAN);
    try {
      const r = await runLint(fix, ["--json"]);
      assert.equal(r.code, 0, describeResult(r));
      const line = oneJsonLine(r.stdout);
      assert.equal(line.schemaVersion, 1);
      assert.ok(Array.isArray(line.fresh));
      assert.equal((line.fresh as unknown[]).length, 0);
      assert.ok(
        typeof line.filesScanned === "number" &&
          (line.filesScanned as number) >= 1,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("hexagen-lint --json on a violating tree exits 1 with fresh violations", async () => {
    const fix = await lintableFixture(VIOLATING);
    try {
      const r = await runLint(fix, ["--json"]);
      assert.equal(r.code, 1, describeResult(r));
      const line = oneJsonLine(r.stdout);
      assert.equal(line.schemaVersion, 1);
      assert.ok(Array.isArray(line.fresh));
      assert.ok((line.fresh as unknown[]).length >= 1);
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("hexagen arch validate --json on a clean tree exits 0 with one compliant line", async () => {
    const fix = await lintableFixture(CLEAN);
    try {
      const r = await runHexagen(fix, ["arch", "validate", "--json"]);
      assert.equal(r.code, 0, describeResult(r));
      const line = oneJsonLine(r.stdout);
      assert.equal(line.status, "compliant");
      assert.equal(line.exitCode, 0);
      assert.equal(line.schemaVersion, 1);
      assert.equal(line.command, "arch validate");
      assert.equal(line.reason, null);
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("hexagen arch validate --json on a violating tree exits 1 with a violations line", async () => {
    const fix = await lintableFixture(VIOLATING);
    try {
      const r = await runHexagen(fix, ["arch", "validate", "--json"]);
      assert.equal(r.code, 1, describeResult(r));
      const line = oneJsonLine(r.stdout);
      assert.equal(line.status, "violations");
      assert.equal(line.exitCode, 1);
      assert.ok(typeof line.fresh === "number" && (line.fresh as number) >= 1);
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("hexagen arch validate --json on a broken manifest exits 2 with a could-not-run line", async () => {
    const manifest = VALID_MANIFEST + "bogus_unknown_key: 1\n";
    const fix = await createPublishedLayoutFixture(manifest, FIXTURE_PREFIX);
    try {
      const r = await runHexagen(fix, ["arch", "validate", "--json"]);
      assert.equal(r.code, 2, describeResult(r));
      const line = oneJsonLine(r.stdout);
      assert.equal(line.status, "could-not-run");
      assert.ok(typeof line.reason === "string" && line.reason.length > 0);
      assert.equal(line.fresh, null);
      assert.ok(r.stderr.includes("Could not load architecture manifest"));
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("hexagen arch validate --json with the linter removed exits 2 with a not-found reason", async () => {
    const fix = await lintableFixture(CLEAN);
    try {
      const binDir = path.join(fix.root, "node_modules", ".bin");
      await fs.rm(path.join(binDir, "hexagen-lint"), { force: true });
      await fs.rm(path.join(binDir, "hexagen-lint.cmd"), { force: true });
      const r = await runHexagen(fix, ["arch", "validate", "--json"]);
      assert.equal(r.code, 2, describeResult(r));
      const line = oneJsonLine(r.stdout);
      assert.equal(line.status, "could-not-run");
      assert.ok(
        typeof line.reason === "string" && line.reason.includes("not found"),
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("hexagen arch validate --json with a crashed linter exits 2 with a could-not-run line", async () => {
    const fix = await lintableFixture(CLEAN);
    try {
      // A fake linter that dies the way a crashed process does: exit 1, a
      // stack trace on stderr, no JSON line. This used to be classified as
      // violations/exit 1 (H2a review fix 1).
      await writeBinStub(
        path.join(fix.root, "node_modules", ".bin"),
        "hexagen-lint",
        {
          sh: `#!/bin/sh\nexec "${process.execPath}" -e "throw new Error('boom')"\n`,
          cmd: `@echo off\r\n"${process.execPath}" -e "throw new Error('boom')"\r\n`,
        },
      );
      const r = await runHexagen(fix, ["arch", "validate", "--json"]);
      assert.equal(r.code, 2, describeResult(r));
      const line = oneJsonLine(r.stdout);
      assert.equal(line.status, "could-not-run");
      assert.equal(line.exitCode, 2);
      assert.ok(
        typeof line.reason === "string" &&
          line.reason.includes("exited 1 but printed no readable JSON line"),
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("hexagen arch validate --json with no manifest exits 2 with a could-not-run line", async () => {
    // clientRepo: no .architecture/manifest.yaml in the fixture and none
    // above it (the fixture lives under the test TMPDIR, outside any
    // HexaGen project). This used to process.exit(1) with no JSON line
    // (H2a review fix 2).
    const fix = await createPublishedLayoutFixture(
      VALID_MANIFEST,
      FIXTURE_PREFIX,
      {
        clientRepo: true,
      },
    );
    try {
      const r = await runHexagen(fix, ["arch", "validate", "--json"]);
      assert.equal(r.code, 2, describeResult(r));
      const line = oneJsonLine(r.stdout);
      assert.equal(line.status, "could-not-run");
      assert.equal(line.exitCode, 2);
      assert.ok(
        typeof line.reason === "string" &&
          line.reason.startsWith("no .architecture/manifest.yaml found from "),
      );
      assert.equal(line.fresh, null);
    } finally {
      await cleanupFixture(fix.root);
    }
  });
});
