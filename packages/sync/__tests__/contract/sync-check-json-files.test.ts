/**
 * `sync --check --json` per-file drift contract — the new `files` key
 * (lane HX2). The fixture/spawn shape is copied from check-drift.contract.test.ts
 * (it spawns the built dist/cli.js in the published consumer layout).
 *
 * Pinned here: on a drifted tree `files` is an array whose length equals
 * `pending.total` (safe on this fixture because every generated file has a
 * single owner), every `path` is workspace-relative, the list is sorted by
 * code point, and each entry carries all four keys. The schema version stays
 * 1 — the change is additive.
 */
import assert from "node:assert/strict";
import { describe, it, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type ContractFixture,
  createPublishedLayoutFixture,
  runProcess,
  runHexagen,
  describeResult,
  cleanupFixture,
  assertBuiltArtifactsPresent,
  writeBinStub,
  EXIT_ZERO_STUB,
} from "../helpers/published-layout.js";

const CHECK_MANIFEST = `system: acme-app
scope: acme
architecture: modular-monolith
generator:
  sync:
    layers:
      domain:
        folder: src/domain
      application:
        folder: src/application
        subfolders:
          - ports/in
          - ports/out
          - use-cases
      infrastructure:
        folder: src/infrastructure
        subfolders:
          - adapters
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
      domain:
        entities:
          - Invoice
      application:
        use_cases:
          - Charge
`;

async function runGitOrThrow(args: string[], cwd: string): Promise<string> {
  const r = await runProcess("git", args, cwd);
  assert.equal(
    r.code,
    0,
    `git ${args.join(" ")} failed:\n${describeResult(r)}`,
  );
  return r.stdout;
}

// -c identity flags: CI runners have no global git user configured.
async function gitCommitAll(root: string, message: string): Promise<void> {
  await runGitOrThrow(["add", "-A"], root);
  await runGitOrThrow(
    [
      "-c",
      "user.email=contract@test.invalid",
      "-c",
      "user.name=Contract Test",
      "commit",
      "-q",
      "-m",
      message,
    ],
    root,
  );
}

async function createConvergedFixture(
  prefix: string,
): Promise<ContractFixture> {
  const fix = await createPublishedLayoutFixture(CHECK_MANIFEST, prefix);

  // Preflight stub (the converging real run execs `npx turbo run build`).
  await writeBinStub(
    path.join(fix.root, "node_modules", ".bin"),
    "turbo",
    EXIT_ZERO_STUB,
  );

  // node_modules stays porcelain-invisible; this .gitignore doubles as the
  // protected-file probe (never drift).
  await fs.writeFile(path.join(fix.root, ".gitignore"), "node_modules/\n");
  await runGitOrThrow(["init", "-q"], fix.root);
  await gitCommitAll(fix.root, "fixture baseline");

  const sync = await runHexagen(fix, ["sync"]);
  assert.equal(
    sync.code,
    0,
    `converging sync must succeed:\n${describeResult(sync)}`,
  );
  await gitCommitAll(fix.root, "converged");

  return fix;
}

describe("sync --check --json files key — built dist in published layout", () => {
  beforeAll(assertBuiltArtifactsPresent);

  function oneJsonLine(stdout: string): Record<string, unknown> {
    const lines = stdout.trim().split("\n");
    assert.equal(
      lines.length,
      1,
      `stdout must be exactly one line:\n${stdout}`,
    );
    return JSON.parse(lines[0]) as Record<string, unknown>;
  }

  function codePointCompare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  interface DriftEntry {
    path: string;
    action: string;
    generator: string;
    reason: string;
  }

  function driftComparator(a: DriftEntry, b: DriftEntry): number {
    const byPath = codePointCompare(a.path, b.path);
    if (byPath !== 0) return byPath;
    const byAction = codePointCompare(a.action, b.action);
    if (byAction !== 0) return byAction;
    return codePointCompare(a.generator, b.generator);
  }

  it("drift: files matches pending.total, is relative, sorted, and fully keyed", async () => {
    const fix = await createConvergedFixture("hexagen-check-json-files-");
    try {
      const pkgRel = path.join("packages", "billing", "package.json");
      await fs.rm(path.join(fix.root, pkgRel));
      await gitCommitAll(fix.root, "drift: remove generated package.json");

      const r = await runHexagen(fix, ["sync", "--check", "--json"]);
      assert.equal(
        r.code,
        1,
        `--check --json on a drifted tree must exit 1:\n${describeResult(r)}`,
      );

      const line = oneJsonLine(r.stdout);
      assert.equal(line.schemaVersion, 1);
      assert.equal(line.status, "drift");

      const pending = line.pending as { total: number };
      const files = line.files as DriftEntry[] | null;
      assert.ok(Array.isArray(files), "files must be an array");
      assert.equal(files!.length, pending.total);

      for (const f of files!) {
        assert.ok(
          !f.path.startsWith("/"),
          `path must be workspace-relative:\n${JSON.stringify(f)}`,
        );
        assert.deepEqual(Object.keys(f).sort(), [
          "action",
          "generator",
          "path",
          "reason",
        ]);
      }

      // The list is sorted (code-point comparator, the same one the engine
      // uses) and the fixture's unique-owner paths make the tuple order
      // observable.
      for (let i = 1; i < files!.length; i += 1) {
        assert.ok(
          driftComparator(files![i - 1], files![i]) <= 0,
          `files must be sorted:\n${JSON.stringify(files)}`,
        );
      }
    } finally {
      await cleanupFixture(fix.root);
    }
  });
});
