import assert from "node:assert/strict";
import { describe, it, afterEach } from "vitest";
import { execSync, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncEngine } from "../src/sync-engine.js";
import { createSpyLogger, messagesAt } from "./helpers/spy-logger.js";
import {
  createFixture,
  removeFixture,
  makeValidManifest,
} from "./helpers/fixture-factory.js";
import {
  makeExternalDryRunFlags,
  makeSelfRegenFlags,
} from "./helpers/test-config.js";

// Copied from integration/sync-engine-errors-selfregen.test.ts: the
// self-regen git-check branch (even when skipped via allowDirty:true) is only
// exercised in this suite against a real git repo, so the fixture must be one.
function gitCheckoutMainQuietly(tmpDir: string): void {
  // No shell string: "2>/dev/null || true" is POSIX-only under cmd.exe. But a
  // blanket catch would also swallow REAL failures (a main ref that already
  // exists, a corrupt HEAD, git missing from PATH), leaving the fixture on
  // whatever branch `git init` picked while the tests still pass. Tolerate
  // only the verified benign outcome — HEAD already resolves to main
  // (unborn via init.defaultBranch=main, or checked out) — and fail the
  // setup loudly on anything else.
  try {
    execFileSync("git", ["checkout", "-b", "main", "--quiet"], {
      cwd: tmpDir,
      stdio: "ignore",
    });
  } catch {
    let currentBranch: string | null = null;
    try {
      currentBranch = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd: tmpDir,
        encoding: "utf8",
      }).trim();
    } catch {
      // Unreadable or detached HEAD — never benign for a fresh fixture.
    }
    if (currentBranch !== "main") {
      throw new Error(
        `gitCheckoutMainQuietly: 'git checkout -b main' failed and HEAD is ${
          currentBranch ?? "unreadable"
        } — refusing to continue the fixture on an unexpected branch`,
      );
    }
  }
}

async function makeFixtureRepo(tmpDir: string): Promise<void> {
  execSync("git init --quiet", { cwd: tmpDir });
  execSync('git config user.name "test"', { cwd: tmpDir });
  execSync('git config user.email "test@test"', { cwd: tmpDir });
  gitCheckoutMainQuietly(tmpDir);
  await fs.writeFile(path.join(tmpDir, ".gitkeep"), "");
  execSync("git add .", { cwd: tmpDir });
  execSync('git commit -m "init" --quiet', { cwd: tmpDir });
}

describe("SyncEngine — per-phase timings", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("external mode reports only the generators timing; git/preflight/linter are null", async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
    });

    const summary = await engine.run();

    assert.ok(summary.phaseTimingsMs, "phaseTimingsMs must be defined");
    assert.equal(summary.phaseTimingsMs.gitStatus, null);
    assert.equal(summary.phaseTimingsMs.preflight, null);
    assert.equal(summary.phaseTimingsMs.linter, null);
    assert.ok(
      typeof summary.phaseTimingsMs.generators === "number" &&
        summary.phaseTimingsMs.generators >= 0,
      `generators timing must be a non-negative number, got ${summary.phaseTimingsMs.generators}`,
    );

    const infos = messagesAt(logger, "info");
    assert.ok(
      infos.some((m) => m.includes("Phase Timings")),
      `expected a Phase Timings log block. Got: ${JSON.stringify(infos)}`,
    );
    assert.ok(
      infos.some((m) => m.startsWith("• generators :")),
      `expected a '• generators :' log line. Got: ${JSON.stringify(infos)}`,
    );
  });

  it("self-regen dry-run with allowDirty:true skips git but times preflight/generators/linter", async () => {
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-phase-timings-"),
    );
    await makeFixtureRepo(fixtureRoot);

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: true, dryRun: true }),
      {
        targetRoot: fixtureRoot,
        manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
      },
    );

    const summary = await engine.run();

    assert.ok(summary.phaseTimingsMs, "phaseTimingsMs must be defined");
    assert.equal(summary.phaseTimingsMs.gitStatus, null);
    for (const phase of ["preflight", "generators", "linter"] as const) {
      const value = summary.phaseTimingsMs[phase];
      assert.ok(
        typeof value === "number" && value >= 0,
        `${phase} timing must be a non-negative number, got ${value}`,
      );
    }
  });
});
