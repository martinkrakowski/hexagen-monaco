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
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it, beforeAll } from "vitest";
import {
  type ContractFixture,
  createPublishedLayoutFixture,
  VALID_MANIFEST,
  runHexagen,
  describeResult,
  cleanupFixture,
  assertBuiltArtifactsPresent,
  writeBinStub,
  EXIT_ZERO_STUB,
} from "../helpers/published-layout.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@test.invalid", "-c", "user.name=t", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

async function createConvergedFixture(
  prefix: string,
): Promise<ContractFixture> {
  const fix = await createPublishedLayoutFixture(VALID_MANIFEST, prefix);
  await writeBinStub(
    path.join(fix.root, "node_modules", ".bin"),
    "turbo",
    EXIT_ZERO_STUB,
  );
  await fs.writeFile(path.join(fix.root, ".gitignore"), "node_modules/\n");
  git(fix.root, "init", "-q");
  git(fix.root, "add", "-A");
  git(fix.root, "commit", "-q", "-m", "fixture baseline");

  const sync = await runHexagen(fix, ["sync"]);
  assert.equal(
    sync.code,
    0,
    `converging sync must succeed:\n${describeResult(sync)}`,
  );
  git(fix.root, "add", "-A");
  git(fix.root, "commit", "-q", "-m", "converged");
  return fix;
}

interface DriftEntry {
  path: string;
  action: string;
  generator: string;
  reason: string;
}

describe("sync --check --json files key — built dist in published layout", () => {
  beforeAll(assertBuiltArtifactsPresent);

  it("drift: files matches pending.total, is relative, sorted, and fully keyed", async () => {
    const fix = await createConvergedFixture("hexagen-check-json-files-");
    try {
      const pkgRel = path.join("packages", "shared", "package.json");
      await fs.rm(path.join(fix.root, pkgRel));
      git(fix.root, "add", "-A");
      git(
        fix.root,
        "commit",
        "-q",
        "-m",
        "drift: remove generated package.json",
      );

      const r = await runHexagen(fix, ["sync", "--check", "--json"]);
      assert.equal(
        r.code,
        1,
        `--check --json on a drifted tree must exit 1:\n${describeResult(r)}`,
      );

      const lines = r.stdout.trim().split("\n");
      assert.equal(
        lines.length,
        1,
        `stdout must be exactly one line:\n${r.stdout}`,
      );
      const line = JSON.parse(lines[0]) as {
        schemaVersion: number;
        status: string;
        pending: { total: number };
        files: DriftEntry[] | null;
      };

      assert.equal(line.schemaVersion, 1);
      assert.equal(line.status, "drift");

      const files = line.files;
      assert.ok(Array.isArray(files), "files must be an array");
      assert.equal(files!.length, line.pending.total);

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

      for (let i = 1; i < files!.length; i += 1) {
        assert.ok(
          files![i - 1].path <= files![i].path,
          `files must be sorted:\n${JSON.stringify(files)}`,
        );
      }
    } finally {
      await cleanupFixture(fix.root);
    }
  });
});
