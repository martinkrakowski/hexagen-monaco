import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { reapLegacyFolders } from "../../src/generators/reap.js";
import type { Manifest } from "../../src/types/manifest.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";

/**
 * Unit tests for `packages/sync/src/generators/reap.ts`.
 *
 * Contract under test (verified against reap.ts):
 *   - Public function: reapLegacyFolders(moduleDir, config, report?) => Promise<void>
 *   - Iterates the fixed legacy layer list ["domain", "application", "infrastructure"].
 *     For each <moduleDir>/<layer>:
 *       · ENOENT  → silently skipped
 *       · empty   → deleted via fs.rm({ recursive: true, force: true })
 *       · non-empty → preserved (guards against delete-recreate cycle —
 *                     folders holding only index.ts are also preserved)
 *   - Dry-run: logs "[DRY-RUN] would delete empty folder <rel>" and does nothing.
 *   - Non-dry-run deletion: logs "deleted empty folder <rel>" and calls
 *     report.record("deleted", layerPath) — NO message argument.
 *   - Non-ENOENT errors propagate.
 *   - No manifest opt-in flag; mode gating lives at the caller in sync-engine.ts.
 *
 * Scaffolding conventions mirror the sibling tests (tsconfig.test.ts, stubs.test.ts):
 *   - disposable temp workspace per test (mkdtemp / rm recursive in finally)
 *   - capturing logger for assertions on log output
 *   - report spy: records {type, target, message} for record() assertions
 *   - host repo is never mutated — everything happens under os.tmpdir().
 */

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

interface CapturedLog {
  level: "error" | "warn" | "info" | "debug";
  message: string;
}

/** Logger that records every call so we can assert on emitted messages. */
function makeCapturingLogger(): {
  logger: LoggerPort;
  logs: CapturedLog[];
} {
  const logs: CapturedLog[] = [];
  const logger: LoggerPort = {
    error: (msg) => {
      logs.push({ level: "error", message: msg });
    },
    warn: (msg) => {
      logs.push({ level: "warn", message: msg });
    },
    info: (msg) => {
      logs.push({ level: "info", message: msg });
    },
    debug: (msg) => {
      logs.push({ level: "debug", message: msg });
    },
    errorWithException: (_err, msg) => {
      logs.push({ level: "error", message: msg ?? "" });
    },
  };
  return { logger, logs };
}

interface RecordCall {
  type: string;
  target: string;
  message: string | undefined;
}

/** Spy matching the optional `report` parameter of reapLegacyFolders. */
function makeReportSpy(): {
  report: { record: (type: string, target: string, message?: string) => void };
  calls: RecordCall[];
} {
  const calls: RecordCall[] = [];
  return {
    report: {
      record: (type, target, message) => {
        calls.push({ type, target, message });
      },
    },
    calls,
  };
}

/** Empty manifest suffices — reap.ts ignores its contents. */
const EMPTY_MANIFEST: Manifest = { bounded_contexts: [] };

function makeConfig(
  workspaceRoot: string,
  logger: LoggerPort,
  opts: { dryRun?: boolean } = {},
): SyncConfig {
  return {
    dryRun: opts.dryRun ?? false,
    force: false,
    forceRoot: false,
    allowDirty: false,
    strict: false,
    mode: "external",
    logger,
    manifest: EMPTY_MANIFEST,
    workspaceRoot,
  };
}

/**
 * Temp-workspace helper matching the convention used in tsconfig.test.ts.
 * Guarantees cleanup even if the test body throws.
 */
async function withTempWorkspace(
  fn: (ctx: { workspaceRoot: string; modulePath: string }) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-reap-test-"),
  );
  const modulePath = path.join(workspaceRoot, "packages", "reap-target");
  await fs.mkdir(modulePath, { recursive: true });
  try {
    await fn({ workspaceRoot, modulePath });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

/** Returns true iff `p` exists (any file type); false on ENOENT; rethrows others. */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

// -----------------------------------------------------------------------------
// Suite 1 — happy path
// -----------------------------------------------------------------------------

describe("reapLegacyFolders – happy path", () => {
  it("deletes an empty legacy 'domain' folder", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config);

      assert.equal(
        await exists(domainDir),
        false,
        "empty domain folder must be deleted",
      );
    });
  });

  it("deletes all three empty legacy layer folders in a single run", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const layers = ["domain", "application", "infrastructure"];
      for (const layer of layers) {
        await fs.mkdir(path.join(modulePath, layer), { recursive: true });
      }

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config, report);

      for (const layer of layers) {
        assert.equal(
          await exists(path.join(modulePath, layer)),
          false,
          `empty ${layer} folder must be deleted`,
        );
      }
      assert.equal(
        calls.length,
        3,
        "report.record should be called once per deleted layer",
      );
    });
  });

  it("preserves a legacy folder that contains a barrel (index.ts)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });
      const barrel = path.join(domainDir, "index.ts");
      await fs.writeFile(barrel, "export {};\n", "utf8");

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config, report);

      // Guard against delete-recreate cycle: the barrel-holding folder must
      // survive intact, and no "deleted" record must be emitted for it.
      assert.equal(await exists(domainDir), true, "domain folder must remain");
      assert.equal(
        await exists(barrel),
        true,
        "index.ts barrel must remain untouched",
      );
      assert.equal(
        calls.length,
        0,
        "no report.record call expected when folder is preserved",
      );
    });
  });

  it("preserves a legacy folder that contains a nested sub-directory", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const domainDir = path.join(modulePath, "domain");
      const nested = path.join(domainDir, "entities");
      await fs.mkdir(nested, { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config, report);

      assert.equal(
        await exists(domainDir),
        true,
        "non-empty domain folder must be preserved",
      );
      assert.equal(
        await exists(nested),
        true,
        "nested entities/ folder must be preserved",
      );
      assert.equal(calls.length, 0, "no deletions should be recorded");
    });
  });
});

// -----------------------------------------------------------------------------
// Suite 2 — no-op
// -----------------------------------------------------------------------------

describe("reapLegacyFolders – no-op", () => {
  it("does nothing when no legacy folders exist (all ENOENT)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const { logger, logs } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config, report);

      assert.equal(calls.length, 0, "no report.record calls expected");
      const deletionLogs = logs.filter((l) =>
        l.message.startsWith("deleted empty folder"),
      );
      assert.equal(
        deletionLogs.length,
        0,
        "no deletion log lines expected when nothing exists",
      );
    });
  });

  it("is idempotent: a second run is a clean no-op", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report: report1 } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger);

      // First run: deletes the empty folder.
      await reapLegacyFolders(modulePath, config, report1);
      assert.equal(
        await exists(domainDir),
        false,
        "domain folder should be deleted by the first run",
      );

      // Second run on now-missing folder must not throw and must record nothing.
      const { report: report2, calls: calls2 } = makeReportSpy();
      await reapLegacyFolders(modulePath, config, report2);
      assert.equal(
        calls2.length,
        0,
        "second run on absent folder must record nothing",
      );
    });
  });

  it("works without a report argument (undefined, no throw)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, logger);

      // Deliberately omit the third argument.
      await reapLegacyFolders(modulePath, config);

      assert.equal(
        await exists(domainDir),
        false,
        "deletion must still occur when report is omitted",
      );
    });
  });
});

// -----------------------------------------------------------------------------
// Suite 3 — dry-run
// -----------------------------------------------------------------------------

describe("reapLegacyFolders – dry-run", () => {
  it("does not delete anything when dryRun=true", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const layers = ["domain", "application", "infrastructure"];
      for (const layer of layers) {
        await fs.mkdir(path.join(modulePath, layer), { recursive: true });
      }

      const { logger } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, logger, { dryRun: true });

      await reapLegacyFolders(modulePath, config);

      for (const layer of layers) {
        assert.equal(
          await exists(path.join(modulePath, layer)),
          true,
          `${layer} folder must be preserved under dry-run`,
        );
      }
    });
  });

  it("logs '[DRY-RUN] would delete empty folder …' for each empty layer", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const layers = ["domain", "application", "infrastructure"];
      for (const layer of layers) {
        await fs.mkdir(path.join(modulePath, layer), { recursive: true });
      }

      const { logger, logs } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, logger, { dryRun: true });

      await reapLegacyFolders(modulePath, config);

      const dryRunLogs = logs.filter((l) =>
        l.message.startsWith("[DRY-RUN] would delete empty folder "),
      );
      assert.equal(
        dryRunLogs.length,
        3,
        "one dry-run log line expected per empty layer",
      );

      const relDomain = path.relative(
        workspaceRoot,
        path.join(modulePath, "domain"),
      );
      assert.ok(
        dryRunLogs.some((l) =>
          l.message.endsWith(
            `[DRY-RUN] would delete empty folder ${relDomain}`,
          ),
        ) || dryRunLogs.some((l) => l.message.includes(relDomain)),
        "dry-run log must reference the workspace-relative layer path",
      );
    });
  });

  it("does not call report.record under dry-run", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      await fs.mkdir(path.join(modulePath, "domain"), { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger, { dryRun: true });

      await reapLegacyFolders(modulePath, config, report);

      assert.equal(
        calls.length,
        0,
        "report.record must not be invoked under dry-run",
      );
    });
  });
});

// -----------------------------------------------------------------------------
// Suite 4 — logging
// -----------------------------------------------------------------------------

describe("reapLegacyFolders – logging", () => {
  it("emits 'deleted empty folder …' info log per deletion", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const layers = ["domain", "application"];
      for (const layer of layers) {
        await fs.mkdir(path.join(modulePath, layer), { recursive: true });
      }

      const { logger, logs } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config);

      const deletionLogs = logs.filter(
        (l) =>
          l.level === "info" && l.message.startsWith("deleted empty folder "),
      );
      assert.equal(
        deletionLogs.length,
        2,
        "one info log line expected per deleted layer",
      );

      const relDomain = path.relative(
        workspaceRoot,
        path.join(modulePath, "domain"),
      );
      const relApp = path.relative(
        workspaceRoot,
        path.join(modulePath, "application"),
      );
      assert.ok(
        deletionLogs.some(
          (l) => l.message === `deleted empty folder ${relDomain}`,
        ),
        `expected log line 'deleted empty folder ${relDomain}'`,
      );
      assert.ok(
        deletionLogs.some(
          (l) => l.message === `deleted empty folder ${relApp}`,
        ),
        `expected log line 'deleted empty folder ${relApp}'`,
      );
    });
  });
});

// -----------------------------------------------------------------------------
// Suite 5 — error handling
// -----------------------------------------------------------------------------

describe("reapLegacyFolders – error handling", () => {
  it("swallows ENOENT gracefully (moduleDir itself doesn't exist)", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      // moduleDir path points into the temp workspace but was never created.
      const missingModuleDir = path.join(
        workspaceRoot,
        "packages",
        "never-created",
      );

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger);

      // Must not throw — every readdir hits ENOENT and is swallowed.
      await reapLegacyFolders(missingModuleDir, config, report);

      assert.equal(
        calls.length,
        0,
        "no report.record calls when nothing exists",
      );
    });
  });

  it("propagates non-ENOENT errors (e.g. ENOTDIR when a layer path is a file)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      // Create a FILE named "domain" — readdir will fail with ENOTDIR,
      // which is not ENOENT and must therefore propagate.
      const domainAsFile = path.join(modulePath, "domain");
      await fs.writeFile(domainAsFile, "not a directory\n", "utf8");

      const { logger } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, logger);

      let caught: unknown;
      try {
        await reapLegacyFolders(modulePath, config);
      } catch (e) {
        caught = e;
      }

      assert.ok(caught, "expected reapLegacyFolders to throw");
      const code = (caught as NodeJS.ErrnoException).code;
      assert.notEqual(code, "ENOENT", "ENOENT must be swallowed, not thrown");
      assert.ok(
        code === "ENOTDIR" || code === "EISDIR" || typeof code === "string",
        `expected a non-ENOENT errno error, got code=${String(code)}`,
      );
    });
  });
});

// -----------------------------------------------------------------------------
// Suite 6 — scope safety
// -----------------------------------------------------------------------------

describe("reapLegacyFolders – scope safety", () => {
  it("never deletes siblings or workspace-root-level same-named folders", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      // Layout:
      //   <workspaceRoot>/domain                         <-- outside modulePath, MUST survive
      //   <workspaceRoot>/packages/reap-target/domain    <-- empty, must be deleted
      //   <workspaceRoot>/packages/reap-target-sibling/  <-- sibling, MUST survive
      //   <workspaceRoot>/packages/reap-target-sibling/domain <-- MUST survive
      const outsideDomain = path.join(workspaceRoot, "domain");
      await fs.mkdir(outsideDomain, { recursive: true });
      await fs.writeFile(
        path.join(outsideDomain, "marker.txt"),
        "outside\n",
        "utf8",
      );

      const innerDomain = path.join(modulePath, "domain");
      await fs.mkdir(innerDomain, { recursive: true });

      const siblingDomain = path.join(
        workspaceRoot,
        "packages",
        "reap-target-sibling",
        "domain",
      );
      await fs.mkdir(siblingDomain, { recursive: true });
      await fs.writeFile(
        path.join(siblingDomain, "marker.txt"),
        "sibling\n",
        "utf8",
      );

      const { logger } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config);

      assert.equal(
        await exists(innerDomain),
        false,
        "empty inner domain must be deleted",
      );
      assert.equal(
        await exists(outsideDomain),
        true,
        "workspace-root domain folder must NOT be touched",
      );
      assert.equal(
        await exists(path.join(outsideDomain, "marker.txt")),
        true,
        "workspace-root domain contents must NOT be touched",
      );
      assert.equal(
        await exists(siblingDomain),
        true,
        "sibling package's domain folder must NOT be touched",
      );
      assert.equal(
        await exists(path.join(siblingDomain, "marker.txt")),
        true,
        "sibling package's domain contents must NOT be touched",
      );
    });
  });

  it("does not traverse non-legacy directories under moduleDir", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      // An empty, non-legacy directory alongside the three layers.
      // reap.ts iterates a fixed allow-list; anything else must be ignored.
      const srcDir = path.join(modulePath, "src");
      await fs.mkdir(srcDir, { recursive: true });
      const miscDir = path.join(modulePath, "scripts");
      await fs.mkdir(miscDir, { recursive: true });

      // Also include one empty legacy folder to prove the reaper is active.
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config, report);

      assert.equal(
        await exists(domainDir),
        false,
        "empty legacy domain folder must still be deleted",
      );
      assert.equal(
        await exists(srcDir),
        true,
        "non-legacy 'src' folder must be left untouched, even when empty",
      );
      assert.equal(
        await exists(miscDir),
        true,
        "non-legacy 'scripts' folder must be left untouched, even when empty",
      );

      // Exactly one deletion record expected — the domain folder.
      assert.equal(calls.length, 1, "only one deletion record expected");
      assert.equal(calls[0]?.target, domainDir);
    });
  });
});

// -----------------------------------------------------------------------------
// Suite 7 — report contract
// -----------------------------------------------------------------------------

describe("reapLegacyFolders – report contract", () => {
  it("records { type: 'deleted', target: <absolute path>, message: undefined }", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config, report);

      assert.equal(calls.length, 1, "exactly one deletion expected");
      const only = calls[0]!;
      assert.equal(only.type, "deleted", "record type must be 'deleted'");
      assert.equal(
        only.target,
        domainDir,
        "record target must be the absolute layer path passed to fs.rm",
      );
      assert.ok(
        path.isAbsolute(only.target),
        "record target must be an absolute path",
      );
      assert.equal(
        only.message,
        undefined,
        "reap.ts must call report.record with no message argument",
      );
    });
  });

  it("record counts match on-disk deletions (2 empty deleted, 1 non-empty preserved)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, modulePath }) => {
      // domain + application are empty → should be deleted (2 records).
      // infrastructure is non-empty → must be preserved (0 records).
      const domainDir = path.join(modulePath, "domain");
      const appDir = path.join(modulePath, "application");
      const infraDir = path.join(modulePath, "infrastructure");
      await fs.mkdir(domainDir, { recursive: true });
      await fs.mkdir(appDir, { recursive: true });
      await fs.mkdir(infraDir, { recursive: true });
      await fs.writeFile(
        path.join(infraDir, "index.ts"),
        "export {};\n",
        "utf8",
      );

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, logger);

      await reapLegacyFolders(modulePath, config, report);

      assert.equal(await exists(domainDir), false, "domain must be deleted");
      assert.equal(await exists(appDir), false, "application must be deleted");
      assert.equal(
        await exists(infraDir),
        true,
        "non-empty infrastructure must be preserved",
      );

      assert.equal(
        calls.length,
        2,
        "exactly two deletion records expected (domain + application)",
      );
      const targets = new Set(calls.map((c) => c.target));
      assert.ok(targets.has(domainDir), "domain deletion must be recorded");
      assert.ok(targets.has(appDir), "application deletion must be recorded");
      assert.ok(
        !targets.has(infraDir),
        "preserved infrastructure must NOT produce a record",
      );
      for (const c of calls) {
        assert.equal(c.type, "deleted");
        assert.equal(c.message, undefined);
      }
    });
  });
});
