import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { reapLegacyFolders } from "../../src/generators/reap.js";
import type { Manifest } from "../../src/types/manifest.js";
import { makeCapturingLogger } from "../helpers/spy-logger.js";
import { withTempWorkspace, exists } from "../helpers/fs-helpers.js";
import { makeConfig, makeReportSpy } from "../helpers/test-config.js";

const EMPTY_MANIFEST: Manifest = { bounded_contexts: [] };

describe("reapLegacyFolders – happy path", () => {
  it("deletes an empty legacy 'domain' folder", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

      await reapLegacyFolders(modulePath, config);

      assert.equal(
        await exists(domainDir),
        false,
        "empty domain folder must be deleted",
      );
    });
  });

  it("deletes all three empty legacy layer folders in a single run", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const layers = ["domain", "application", "infrastructure"];
      for (const layer of layers) {
        await fs.mkdir(path.join(modulePath, layer), { recursive: true });
      }

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

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
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });
      const barrel = path.join(domainDir, "index.ts");
      await fs.writeFile(barrel, "export {};\n", "utf8");

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

      await reapLegacyFolders(modulePath, config, report);

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

  it("preserves a legacy folder that contains only a leaf .gitkeep (PR-C2 keep, plan B2)", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });
      const keep = path.join(domainDir, ".gitkeep");
      await fs.writeFile(keep, "", "utf8");

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

      await reapLegacyFolders(modulePath, config, report);

      // A leaf .gitkeep makes the dir non-empty, so reap preserves it. reap
      // can't tell a configured-leaf keep from a de-configured orphan, and
      // deleting a freshly-emitted keep would re-open the delete-recreate cycle
      // (the documented B2 limitation). This pins that preservation so a future
      // "treat a lone .gitkeep as empty" change fails loudly.
      assert.equal(await exists(domainDir), true, "domain folder must remain");
      assert.equal(
        await exists(keep),
        true,
        "the leaf .gitkeep must remain untouched",
      );
      assert.equal(
        calls.length,
        0,
        "no report.record call expected when a keep-only folder is preserved",
      );
    });
  });

  it("preserves a legacy folder that contains a nested sub-directory", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const domainDir = path.join(modulePath, "domain");
      const nested = path.join(domainDir, "entities");
      await fs.mkdir(nested, { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

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

describe("reapLegacyFolders – no-op", () => {
  it("does nothing when no legacy folders exist (all ENOENT)", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });

      const { logger, logs } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

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
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report: report1 } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

      await reapLegacyFolders(modulePath, config, report1);
      assert.equal(
        await exists(domainDir),
        false,
        "domain folder should be deleted by the first run",
      );

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
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

      await reapLegacyFolders(modulePath, config);

      assert.equal(
        await exists(domainDir),
        false,
        "deletion must still occur when report is omitted",
      );
    });
  });
});

describe("reapLegacyFolders – dry-run", () => {
  it("does not delete anything when dryRun=true", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const layers = ["domain", "application", "infrastructure"];
      for (const layer of layers) {
        await fs.mkdir(path.join(modulePath, layer), { recursive: true });
      }

      const { logger } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, {
        logger,
        dryRun: true,
      });

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
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const layers = ["domain", "application", "infrastructure"];
      for (const layer of layers) {
        await fs.mkdir(path.join(modulePath, layer), { recursive: true });
      }

      const { logger, logs } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, {
        logger,
        dryRun: true,
      });

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
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      await fs.mkdir(path.join(modulePath, "domain"), { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, {
        logger,
        dryRun: true,
      });

      await reapLegacyFolders(modulePath, config, report);

      assert.equal(
        calls.length,
        0,
        "report.record must not be invoked under dry-run",
      );
    });
  });
});

describe("reapLegacyFolders – logging", () => {
  it("emits 'deleted empty folder …' info log per deletion", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const layers = ["domain", "application"];
      for (const layer of layers) {
        await fs.mkdir(path.join(modulePath, layer), { recursive: true });
      }

      const { logger, logs } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

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

describe("reapLegacyFolders – error handling", () => {
  it("swallows ENOENT gracefully (moduleDir itself doesn't exist)", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const missingModuleDir = path.join(
        workspaceRoot,
        "packages",
        "never-created",
      );

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

      await reapLegacyFolders(missingModuleDir, config, report);

      assert.equal(
        calls.length,
        0,
        "no report.record calls when nothing exists",
      );
    });
  });

  it("propagates non-ENOENT errors (e.g. ENOTDIR when a layer path is a file)", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const domainAsFile = path.join(modulePath, "domain");
      await fs.writeFile(domainAsFile, "not a directory\n", "utf8");

      const { logger } = makeCapturingLogger();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

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

describe("reapLegacyFolders – scope safety", () => {
  it("never deletes siblings or workspace-root-level same-named folders", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });

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
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

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
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });

      const srcDir = path.join(modulePath, "src");
      await fs.mkdir(srcDir, { recursive: true });
      const miscDir = path.join(modulePath, "scripts");
      await fs.mkdir(miscDir, { recursive: true });

      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

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

      assert.equal(calls.length, 1, "only one deletion record expected");
      assert.equal(calls[0]?.target, domainDir);
    });
  });
});

describe("reapLegacyFolders – report contract", () => {
  it("records { type: 'deleted', target: <absolute path>, message: undefined }", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
      const domainDir = path.join(modulePath, "domain");
      await fs.mkdir(domainDir, { recursive: true });

      const { logger } = makeCapturingLogger();
      const { report, calls } = makeReportSpy();
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

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
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modulePath = path.join(workspaceRoot, "packages", "reap-target");
      await fs.mkdir(modulePath, { recursive: true });
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
      const config = makeConfig(workspaceRoot, EMPTY_MANIFEST, { logger });

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
