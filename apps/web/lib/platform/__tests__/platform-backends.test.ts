// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BACKENDS,
  openBackend,
  failOnSql,
  type Backend,
} from "../../../test-support/platform-backends";

describe.each(BACKENDS)("platform-backends (%s)", (kind) => {
  let backend: Backend;

  afterEach(async () => {
    if (backend) await backend.close();
  });

  it("openBackend gives an empty, working store", async () => {
    backend = await openBackend(kind);
    assert.equal(backend.db.dialect, kind);
    const free = await backend.store.billing.resolve("nobody");
    assert.equal(free.plan, "free");
    assert.equal(free.repoLimit, 0);
    assert.equal(free.status, "none");
  });

  it("two backends of one kind do not see each other's rows", async () => {
    const a = await openBackend(kind);
    try {
      const b = await openBackend(kind);
      try {
        await a.store.markProjectsInitialized("owner-a");
        assert.equal(await b.store.isProjectsInitialized("owner-a"), false);
      } finally {
        await b.close();
      }
    } finally {
      await a.close();
    }
  });

  it("close removes the artifacts directory it made, and leaves a caller's own", async () => {
    const own = mkdtempSync(join(tmpdir(), "hx-caller-dir-"));
    try {
      const made = await openBackend(kind);
      const madeDir = made.store.scanArtifactsDir;
      const given = await openBackend(kind, { artifactsDir: own });
      await made.close();
      await given.close();
      assert.equal(existsSync(madeDir), false);
      assert.equal(existsSync(own), true);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  it("failOnSql: a plain call that matches rejects with the given error and writes nothing", async () => {
    backend = await openBackend(kind);
    const boom = new Error("boom");
    const bad = failOnSql(
      backend.db,
      (sql) => sql.includes("INSERT INTO audit_log"),
      boom,
    );
    await expect(
      bad.run(
        "INSERT INTO audit_log (id, actor_id, action, created_at) VALUES ('x', 'a', 'action', '2026-01-01T00:00:00.000Z')",
      ),
    ).rejects.toBe(boom);
    const n = await backend.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log",
    );
    assert.equal(n?.n, 0);
  });

  it("failOnSql: a statement that fails inside a transaction rolls back the earlier statements of that transaction", async () => {
    backend = await openBackend(kind);
    const boom = new Error("boom");
    const bad = failOnSql(
      backend.db,
      (sql) => sql.includes("INSERT INTO audit_log"),
      boom,
    );
    await expect(
      bad.transaction(async (tx) => {
        await tx.run(
          "INSERT INTO project_owner_state (owner_id, initialized) VALUES (?, TRUE)",
          ["owner-a"],
        );
        await tx.run(
          "INSERT INTO audit_log (id, actor_id, action, created_at) VALUES ('x', 'a', 'action', '2026-01-01T00:00:00.000Z')",
        );
      }),
    ).rejects.toBe(boom);
    const n = await backend.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM project_owner_state",
    );
    assert.equal(typeof n?.n, "number");
    assert.equal(n?.n, 0);
  });

  it("failOnSql keeps the nested-call guard", async () => {
    backend = await openBackend(kind);
    const boom = new Error("boom");
    const bad = failOnSql(backend.db, () => false, boom);
    await expect(
      bad.transaction(async () => {
        await bad.run("SELECT 1");
      }),
    ).rejects.toThrow(/plain db call inside a transaction/);
  });

  it("close twice resolves", async () => {
    backend = await openBackend(kind);
    await backend.close();
    await expect(backend.close()).resolves.toBeUndefined();
  });
});
