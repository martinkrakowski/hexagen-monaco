import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SyncEngine } from "../../src/sync-engine.js";
import { createSpyLogger, messagesAt } from "../helpers/spy-logger.js";
import {
  createFixture,
  removeFixture,
  makeValidManifest,
} from "../helpers/fixture-factory.js";
import { pathExists } from "../helpers/fs-helpers.js";
import { makeExternalDryRunFlags } from "../helpers/test-config.js";

describe("SyncEngine — git-check branch logging (external mode)", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it('logs "Skipping git check (external mode)" when mode is "external"', async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
    });

    await engine.run();

    const infos = messagesAt(logger, "info");
    assert.ok(
      infos.some((m) => m === "Skipping git check (external mode)"),
      `expected "Skipping git check (external mode)" in info log. Got: ${JSON.stringify(infos)}`,
    );
    assert.ok(
      !messagesAt(logger, "error").some((m) =>
        m.includes("Git working tree is dirty"),
      ),
      "external mode must not emit git-dirty error",
    );
  });
});

describe("SyncEngine — invalid manifest", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("logs the duplicate-context error, rejects, and does NOT run rollback in dry-run", async () => {
    fixtureRoot = await createFixture(["shared"]);
    const logger = createSpyLogger();

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      manifest: makeValidManifest([
        { name: "shared", type: "shared-kernel" },
        { name: "shared", type: "core" },
      ]),
    });

    // Pre-A1 this resolved (the swallow); the wizard adapter relies on the
    // rejection to map failures into a Result.
    await assert.rejects(() => engine.run(), /duplicate bounded context names/);

    const errors = messagesAt(logger, "error");
    assert.ok(
      errors.some(
        (m) =>
          m.includes("Sync failed") &&
          m.includes("duplicate bounded context names") &&
          m.includes("shared"),
      ),
      `expected duplicate-context error in error log. Got: ${JSON.stringify(errors)}`,
    );
  });

  it('warns about "missing type field" but completes sync when a context omits `type`', async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      manifest: makeValidManifest([{ name: "alpha" }]),
    });

    await engine.run();

    const warns = messagesAt(logger, "warn");
    assert.ok(
      warns.some(
        (m) => m.includes('"alpha"') && m.includes("missing type field"),
      ),
      `expected "missing type field" warning. Got: ${JSON.stringify(warns)}`,
    );

    const infos = messagesAt(logger, "info");
    assert.ok(
      infos.some((m) => m.includes("Sync completed successfully")),
      "sync should complete after a non-fatal warning",
    );
    assert.deepEqual(
      messagesAt(logger, "error"),
      [],
      "missing-type should warn, never error",
    );
  });
});

describe("SyncEngine — manifest-on-disk absent", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("warns and synthesizes empty manifest in dry-run when file is absent", async () => {
    fixtureRoot = await createFixture([]);
    const logger = createSpyLogger();

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
    });

    await engine.run();

    const warns = messagesAt(logger, "warn");
    assert.ok(
      warns.some((m) =>
        m.includes("Manifest not found — using empty for dry-run"),
      ),
      `expected dry-run empty-manifest warning. Got: ${JSON.stringify(warns)}`,
    );
    assert.ok(
      messagesAt(logger, "info").some((m) =>
        m.includes("Sync completed successfully"),
      ),
      "dry-run with empty manifest must complete successfully",
    );
    assert.deepEqual(
      messagesAt(logger, "error"),
      [],
      "missing manifest in dry-run must not produce error-level logs",
    );
  });
});

describe("SyncEngine — path-traversal defense (dry-run)", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("skips bounded contexts whose name would escape the packages directory", async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();

    const evilNames = ["../../etc/passwd", "foo/bar", ".hidden"];
    const manifest = makeValidManifest([
      { name: "alpha", type: "core" },
      ...evilNames.map((n) => ({ name: n, type: "core" as const })),
    ]);

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      manifest,
    });

    await engine.run();

    const warns = messagesAt(logger, "warn");
    for (const evil of evilNames) {
      const hits = warns.filter(
        (m) => m.includes("Skipping invalid module name") && m.includes(evil),
      );
      assert.ok(
        hits.length >= 1,
        `expected path-traversal warning for ${JSON.stringify(evil)}. Got warnings: ${JSON.stringify(warns)}`,
      );
    }

    const pkgDir = path.join(fixtureRoot, "packages");
    const entries = await fs.readdir(pkgDir);
    assert.deepEqual(
      entries.sort(),
      ["alpha"],
      `packages/ must contain only legitimate contexts. Got: ${JSON.stringify(entries)}`,
    );

    const escapedDir = path.resolve(
      fixtureRoot,
      "packages",
      "../../etc/passwd",
    );
    assert.equal(
      await pathExists(escapedDir),
      false,
      `path-traversal target must NOT exist: ${escapedDir}`,
    );

    assert.ok(
      messagesAt(logger, "info").some((m) =>
        m.includes("Sync completed successfully"),
      ),
    );
  });
});

describe("SyncEngine — dry-run failure does NOT invoke rollback", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("does not call process.exit and does not mutate the fixture on forced failure", async () => {
    fixtureRoot = await createFixture(["dup"]);
    const logger = createSpyLogger();

    const before = (await fs.readdir(fixtureRoot)).sort();

    const originalExit = process.exit;
    const exitCalls: Array<number | undefined> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = ((code?: number) => {
      exitCalls.push(code);
      throw new Error(
        `process.exit(${code}) was called — dry-run must skip rollback`,
      );
    }) as never;

    try {
      const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
        targetRoot: fixtureRoot,
        manifest: makeValidManifest([
          { name: "dup", type: "core" },
          { name: "dup", type: "shared-kernel" },
        ]),
      });

      await assert.rejects(
        () => engine.run(),
        /duplicate bounded context names/,
      );

      assert.deepEqual(
        exitCalls,
        [],
        "process.exit must NOT be called in dry-run failure path",
      );

      assert.ok(
        messagesAt(logger, "error").some((m) => m.includes("Sync failed")),
        "dry-run failure still logs Sync failed",
      );
      assert.ok(
        !messagesAt(logger, "info").some((m) =>
          m.includes("Rollback completed"),
        ),
        "rollback must not be attempted in dry-run",
      );

      const after = (await fs.readdir(fixtureRoot)).sort();
      assert.deepEqual(
        after,
        before,
        "dry-run failure must leave the fixture tree untouched",
      );
    } finally {
      process.exit = originalExit;
    }
  });
});
