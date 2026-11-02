import assert from "node:assert/strict";
import { describe, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncEngine } from "../src/sync-engine.js";
import type { SyncFlags } from "../src/config.js";
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

async function makeFixtureRepo(tmpDir: string): Promise<void> {
  execFileSync("git", ["init", "--quiet"], { cwd: tmpDir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: tmpDir });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: tmpDir });
  await fs.writeFile(path.join(tmpDir, ".gitkeep"), "");
  execFileSync("git", ["add", "."], { cwd: tmpDir });
  execFileSync("git", ["commit", "-m", "init", "--quiet"], { cwd: tmpDir });
}

async function createGitFixture(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-sync-phase-timings-"),
  );
  await makeFixtureRepo(dir);
  return dir;
}

async function runTimedEngine(
  targetRoot: string,
  flagsFactory: (logger: ReturnType<typeof createSpyLogger>) => SyncFlags,
) {
  const logger = createSpyLogger();
  const engine = new SyncEngine(flagsFactory(logger), {
    targetRoot,
    manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
  });
  const summary = await engine.run();
  return { summary, logger };
}

describe("SyncEngine — per-phase timings", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("external mode reports only the generators timing; git/preflight/linter are null", async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const { summary, logger } = await runTimedEngine(fixtureRoot, (l) =>
      makeExternalDryRunFlags({ logger: l }),
    );

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
    fixtureRoot = await createGitFixture();

    const { summary } = await runTimedEngine(fixtureRoot, (l) =>
      makeSelfRegenFlags({ logger: l, allowDirty: true, dryRun: true }),
    );

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
