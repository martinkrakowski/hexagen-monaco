// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { SavedProject } from "@hexagen/shared";
import { createPlatformStore } from "../store";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { createSavedProjectsStore } from "../saved-projects-store";
import { createOwnerDocumentsStore } from "../owner-documents-store";
import { createOrgsRepository } from "../orgs-store";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";

function project(id: string, name = id): SavedProject {
  return {
    id,
    name,
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: { workspaceName: name },
    manifestYaml: "system: shop\nbounded_contexts: []\n",
  };
}

function must<T>(
  r: { success: true; value: T } | { success: false; error: unknown },
): T {
  if (!r.success)
    throw new Error(`expected success, got ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("sqlite SavedProjectsPersistencePort", () => {
  it("creates, loads newest-first, updates, and deletes by the port contract", async () => {
    const store = createPlatformStore(":memory:");
    const a = project("11111111-1111-4111-8111-111111111111", "alpha");
    const b = project("22222222-2222-4222-8222-222222222222", "beta");

    const projects = store.projectsFor("owner-a");
    const createdA = await projects.createProjectRecord(a);
    const createdB = await projects.createProjectRecord(b);
    assert.equal(createdA.success, true);
    assert.equal(createdB.success, true);

    const loaded = await projects.loadProjects();
    assert.equal(loaded.success, true);
    if (!loaded.success) return;
    assert.deepEqual(
      loaded.value.map((p) => p.id),
      [b.id, a.id],
    );

    const duplicate = await projects.createProjectRecord(a);
    assert.equal(duplicate.success, false);
    if (!duplicate.success) assert.equal(duplicate.error.kind, "Conflict");

    const updated = await projects.updateProjectRecord(a.id, (current) => ({
      ...current,
      name: "alpha-renamed",
      updatedAt: 9,
    }));
    assert.equal(updated.success, true);
    if (updated.success) assert.equal(updated.value.name, "alpha-renamed");

    const missing = await projects.updateProjectRecord(
      "33333333-3333-4333-8333-333333333333",
      (p) => p,
    );
    assert.equal(missing.success, false);
    if (!missing.success) assert.equal(missing.error.kind, "NotFound");

    const deleted = await projects.deleteProjectRecord(a.id);
    assert.equal(deleted.success, true);
    const again = await projects.deleteProjectRecord(a.id);
    assert.equal(again.success, true);

    const after = await projects.loadProjects();
    assert.equal(after.success, true);
    if (after.success) {
      assert.deepEqual(
        after.value.map((p) => p.id),
        [b.id],
      );
    }
    await store.close();
  });

  it("saveProjects replaces the whole list in the given order", async () => {
    const store = createPlatformStore(":memory:");
    const a = project("11111111-1111-4111-8111-111111111111", "a");
    const b = project("22222222-2222-4222-8222-222222222222", "b");
    const projects = store.projectsFor("owner-a");
    await projects.createProjectRecord(a);
    const written = await projects.saveProjects([a, b]);
    assert.equal(written.success, true);
    const loaded = await projects.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) {
      assert.deepEqual(
        loaded.value.map((p) => p.name),
        ["a", "b"],
      );
    }
    await store.close();
  });

  it("does not leak one owner's projects to another", async () => {
    const store = createPlatformStore(":memory:");
    const a = project("11111111-1111-4111-8111-111111111111", "alpha");
    await store.projectsFor("owner-a").createProjectRecord(a);
    const other = await store.projectsFor("owner-b").loadProjects();
    assert.equal(other.success, true);
    if (other.success) assert.deepEqual(other.value, []);
    await store.close();
  });

  it("putProject rejects a stale If-Match without clobbering the stored row", async () => {
    const store = createPlatformStore(":memory:");
    const a = project("11111111-1111-4111-8111-111111111111", "alpha");
    const projects = store.projectsFor("owner-a");
    await projects.createProjectRecord(a);
    const first = await projects.putProject(
      { ...a, name: "first", updatedAt: 2 },
      1,
    );
    assert.equal(first.success, true);
    const stale = await projects.putProject(
      { ...a, name: "stale", updatedAt: 3 },
      1,
    );
    assert.equal(stale.success, false);
    if (!stale.success) assert.equal(stale.error.kind, "Conflict");
    const loaded = await projects.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.equal(loaded.value[0]?.name, "first");
    await store.close();
  });

  it("deleting a project whose share revoke fails leaves the project in place", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createSavedProjectsStore(platformDb, "owner-a");

    const proj = project("11111111-1111-4111-8111-111111111111", "shared");
    const created = await store.createProjectRecord(proj);
    assert.equal(created.success, true);

    // Plant a live share grant so the delete path has something to revoke.
    db.prepare(
      `INSERT INTO project_shares (owner_id, project_id, grantee_type, grantee_id, role, granted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "owner-a",
      proj.id,
      "user",
      "grantee-1",
      "read",
      "owner-a",
      "2026-01-01T00:00:00Z",
    );

    // Force the share revoke UPDATE to fail inside the transaction. The delete
    // and the revoke share one transaction; a rollback must restore the project
    // row even though the trigger never touched it.
    db.exec(`
      CREATE TRIGGER share_revoke_boom BEFORE UPDATE ON project_shares
      WHEN NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL
      BEGIN SELECT RAISE(ABORT, 'share revoke blocked'); END;
    `);

    const deleted = await store.deleteProjectRecord(proj.id);
    assert.equal(deleted.success, false);
    if (!deleted.success) {
      assert.equal(deleted.error.kind, "SerializationFailed");
    }

    const loaded = await store.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) {
      assert.equal(loaded.value.length, 1);
      assert.equal(loaded.value[0]?.id, proj.id);
    }
    db.close();
  });

  it("two creates started together get different positions, and a repeated id conflicts once", async () => {
    const db = openPlatformDb(":memory:");
    const store = createSavedProjectsStore(
      createSqlitePlatformDb(db),
      "owner-a",
    );
    const ids = [1, 2, 3, 4].map(
      (n) => `2222222${n}-2222-4222-8222-222222222222`,
    );
    // Started in one tick, so their statements would interleave if the check,
    // the MIN(ord) read and the insert were not one transaction.
    const results = await Promise.all(
      ids.map((id) => store.createProjectRecord(project(id))),
    );
    assert.deepEqual(
      results.map((r) => r.success),
      [true, true, true, true],
    );
    const rows = db
      .prepare("SELECT ord FROM saved_projects WHERE owner_id = ?")
      .all("owner-a") as Array<{ ord: number }>;
    assert.equal(new Set(rows.map((r) => r.ord)).size, 4);

    const twice = await Promise.all([
      store.createProjectRecord(
        project("33333333-3333-4333-8333-333333333333"),
      ),
      store.createProjectRecord(
        project("33333333-3333-4333-8333-333333333333"),
      ),
    ]);
    assert.deepEqual(twice.map((r) => r.success).sort(), [false, true]);
    const loser = twice.find((r) => !r.success);
    assert.equal(loser && !loser.success && loser.error.kind, "Conflict");
    db.close();
  });
});

function countDocs(
  db: Database.Database,
  ownerId: string,
  projectId: string | null = null,
): number {
  if (projectId === null) {
    return (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND project_id IS NULL",
        )
        .get(ownerId) as { n: number }
    ).n;
  }
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND project_id = ?",
      )
      .get(ownerId, projectId) as { n: number }
  ).n;
}

describe("saved_projects delete — owner_documents cascade", () => {
  it("deleting a project deletes every author's documents attached to it, and no document of another project or with no project", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrg({
      id: "owner-1",
      slug: "test",
      name: "Test",
      createdBy: "user-a",
    });
    await orgs.addMember("owner-1", "user-a", "member");
    await orgs.addMember("owner-1", "user-b", "member");
    const projects = createSavedProjectsStore(platformDb, "owner-1");
    const docsA = createOwnerDocumentsStore(platformDb, "owner-1", "user-a");
    const docsB = createOwnerDocumentsStore(platformDb, "owner-1", "user-b");
    try {
      const p1: SavedProject = {
        id: "proj-1",
        name: "p1",
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject;
      const p2: SavedProject = {
        id: "proj-2",
        name: "p2",
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject;
      await projects.createProjectRecord(p1);
      await projects.createProjectRecord(p2);

      // Documents attached to proj-1, by two different authors.
      await docsA.put({
        kind: "workspace",
        id: "da-1",
        payload: {},
        projectId: "proj-1",
      });
      await docsB.put({
        kind: "workspace",
        id: "db-1",
        payload: {},
        projectId: "proj-1",
      });
      // A document attached to proj-2 — must survive.
      await docsA.put({
        kind: "workspace",
        id: "da-2",
        payload: {},
        projectId: "proj-2",
      });
      // A detached document — must survive.
      await docsA.put({ kind: "workspace", id: "detached", payload: {} });

      assert.equal(
        countDocs(db, "owner-1", "proj-1"),
        2,
        "setup: 2 docs on proj-1",
      );

      const deleted = await projects.deleteProjectRecord("proj-1");
      assert.equal(deleted.success, true);

      assert.equal(
        countDocs(db, "owner-1", "proj-1"),
        0,
        "docs on proj-1 must be gone",
      );
      assert.equal(
        countDocs(db, "owner-1", "proj-2"),
        1,
        "docs on proj-2 must survive",
      );
      assert.equal(
        countDocs(db, "owner-1", null),
        1,
        "detached docs must survive",
      );
    } finally {
      db.close();
    }
  });

  it("replacing the project list deletes the documents of the projects that were dropped and keeps the survivors'", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const projects = createSavedProjectsStore(platformDb, "user-a");
    const docs = createOwnerDocumentsStore(platformDb, "user-a", "user-a");
    try {
      const p1: SavedProject = {
        id: "keep-1",
        name: "keep-1",
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject;
      const p2: SavedProject = {
        id: "drop-2",
        name: "drop-2",
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject;
      const p3: SavedProject = {
        id: "drop-3",
        name: "drop-3",
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject;
      await projects.createProjectRecord(p1);
      await projects.createProjectRecord(p2);
      await projects.createProjectRecord(p3);

      await docs.put({
        kind: "workspace",
        id: "d1",
        payload: {},
        projectId: "keep-1",
      });
      await docs.put({
        kind: "workspace",
        id: "d2",
        payload: {},
        projectId: "drop-2",
      });
      await docs.put({
        kind: "workspace",
        id: "d3",
        payload: {},
        projectId: "drop-3",
      });
      await docs.put({ kind: "workspace", id: "detached", payload: {} });

      // Replace with only keep-1: drop-2 and drop-3 are removed.
      const replaced = await projects.saveProjects([p1]);
      assert.equal(replaced.success, true);

      assert.equal(
        countDocs(db, "user-a", "keep-1"),
        1,
        "survivor docs must remain",
      );
      assert.equal(
        countDocs(db, "user-a", "drop-2"),
        0,
        "dropped project docs must be gone",
      );
      assert.equal(
        countDocs(db, "user-a", "drop-3"),
        0,
        "dropped project docs must be gone",
      );
      assert.equal(
        countDocs(db, "user-a", null),
        1,
        "detached docs must survive",
      );

      // Replace with an empty list: all attached docs go, detached doc remains.
      const emptied = await projects.saveProjects([]);
      assert.equal(emptied.success, true);

      assert.equal(
        countDocs(db, "user-a", "keep-1"),
        0,
        "survivor docs gone after empty replace",
      );
      assert.equal(
        countDocs(db, "user-a", "drop-2"),
        0,
        "dropped docs gone after empty replace",
      );
      assert.equal(
        countDocs(db, "user-a", null),
        1,
        "detached docs survive an empty replace — they are not 'documents of a project'",
      );
    } finally {
      db.close();
    }
  });
});

describe.each(BACKENDS)("saved projects stored timestamps (%s)", (kind) => {
  it("the stored columns hold the project's own timestamps after create, replace and update", async () => {
    const backend = await openBackend(kind);
    try {
      const projects = backend.store.projectsFor("owner-a");
      const createdAt = 1_700_000_000_000;
      const updatedAt = 1_700_000_001_000;
      const proj: SavedProject = {
        id: "11111111-1111-4111-8111-111111111111",
        name: "alpha",
        schemaVersion: 4,
        createdAt,
        updatedAt,
        formState: {},
        manifestYaml: "",
      };
      must(await projects.createProjectRecord(proj));
      const row = await backend.db.get<{ c: number; u: number }>(
        "SELECT hx_ms(created_at) AS c, hx_ms(updated_at) AS u FROM saved_projects WHERE owner_id = ? AND id = ?",
        ["owner-a", proj.id],
      );
      assert.equal(typeof row.c, "number");
      assert.equal(typeof row.u, "number");
      assert.equal(row.c, createdAt);
      assert.equal(row.u, updatedAt);

      const replacedAt = 1_700_000_002_000;
      must(await projects.saveProjects([{ ...proj, updatedAt: replacedAt }]));
      const after = await backend.db.get<{ c: number; u: number }>(
        "SELECT hx_ms(created_at) AS c, hx_ms(updated_at) AS u FROM saved_projects WHERE owner_id = ? AND id = ?",
        ["owner-a", proj.id],
      );
      assert.equal(typeof after.c, "number");
      assert.equal(typeof after.u, "number");
      assert.equal(after.c, createdAt);
      assert.equal(after.u, replacedAt);

      const updatedTimestamp = 1_700_000_003_000;
      must(
        await projects.updateProjectRecord(proj.id, (p) => ({
          ...p,
          updatedAt: updatedTimestamp,
        })),
      );
      const afterUpdate = await backend.db.get<{ c: number; u: number }>(
        "SELECT hx_ms(created_at) AS c, hx_ms(updated_at) AS u FROM saved_projects WHERE owner_id = ? AND id = ?",
        ["owner-a", proj.id],
      );
      assert.equal(typeof afterUpdate.c, "number");
      assert.equal(typeof afterUpdate.u, "number");
      assert.equal(afterUpdate.c, createdAt);
      assert.equal(afterUpdate.u, updatedTimestamp);

      const loaded = must(await projects.loadProjects());
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].id, proj.id);
      assert.equal(typeof loaded[0].createdAt, "number");
      assert.equal(typeof loaded[0].updatedAt, "number");
      assert.equal(loaded[0].createdAt, createdAt);
      assert.equal(loaded[0].updatedAt, updatedTimestamp);

      const fetched = must(await projects.getProject(proj.id));
      assert.equal(typeof fetched?.createdAt, "number");
      assert.equal(typeof fetched?.updatedAt, "number");
      assert.equal(fetched?.createdAt, createdAt);
      assert.equal(fetched?.updatedAt, updatedTimestamp);
    } finally {
      await backend.close();
    }
  });

  it("the legacy updated_at If-Match accepts the stored value and refuses another", async () => {
    const backend = await openBackend(kind);
    try {
      const projects = backend.store.projectsFor("owner-a");
      const createdAt = 1_700_000_000_000;
      const updatedAt = 1_700_000_001_000;
      const proj: SavedProject = {
        id: "11111111-1111-4111-8111-111111111111",
        name: "alpha",
        schemaVersion: 4,
        createdAt,
        updatedAt,
        formState: {},
        manifestYaml: "",
      };
      must(await projects.createProjectRecord(proj));

      const stored = await backend.db.get<{ u: number }>(
        "SELECT hx_ms(updated_at) AS u FROM saved_projects WHERE owner_id = ? AND id = ?",
        ["owner-a", proj.id],
      );
      assert.equal(typeof stored.u, "number");

      const accepted = must(
        await projects.putProject(
          { ...proj, name: "alpha-v2", updatedAt: updatedAt + 1_000 },
          { updatedAt: stored.u },
        ),
      );
      assert.equal(accepted.rev, 2);

      const rejected = await projects.putProject(
        { ...proj, name: "alpha-v3", updatedAt: updatedAt + 2_000 },
        { updatedAt: stored.u + 1 },
      );
      assert.equal(rejected.success, false);
      if (!rejected.success) assert.equal(rejected.error.kind, "Conflict");

      const after = must(await projects.getProjectWithRev(proj.id));
      assert.equal(after.rev, 2);
      assert.equal(after.project.name, "alpha-v2");
    } finally {
      await backend.close();
    }
  });

  it("a rev precondition matches only the current rev", async () => {
    const backend = await openBackend(kind);
    try {
      const projects = backend.store.projectsFor("owner-a");
      const proj: SavedProject = {
        id: "22222222-2222-4222-8222-222222222222",
        name: "beta",
        schemaVersion: 4,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        formState: {},
        manifestYaml: "",
      };
      must(await projects.createProjectRecord(proj));

      let current = must(await projects.getProjectWithRev(proj.id));
      assert.equal(current.rev, 1);

      // Current rev succeeds and bumps
      const accepted = must(
        await projects.putProject(
          { ...proj, name: "beta-v2", updatedAt: 1_700_000_002_000 },
          { rev: current.rev },
        ),
      );
      assert.equal(accepted.rev, 2);

      // Stale rev is Conflict
      const rejected = await projects.putProject(
        { ...proj, name: "beta-v3", updatedAt: 1_700_000_003_000 },
        { rev: current.rev },
      );
      assert.equal(rejected.success, false);
      if (!rejected.success) assert.equal(rejected.error.kind, "Conflict");

      // No precondition writes unconditionally and still bumps rev
      const unconditional = must(
        await projects.putProject(
          { ...proj, name: "beta-v4", updatedAt: 1_700_000_004_000 },
          undefined,
        ),
      );
      assert.equal(unconditional.rev, 3);

      current = must(await projects.getProjectWithRev(proj.id));
      assert.equal(current.rev, 3);
      assert.equal(current.project.name, "beta-v4");
    } finally {
      await backend.close();
    }
  });

  it("replaceAll upserts survivors (rev rises), deletes only the dropped ids and lists in the given order", async () => {
    const backend = await openBackend(kind);
    try {
      const projects = backend.store.projectsFor("owner-a");
      const mk = (id: string, name: string): SavedProject => ({
        id,
        name,
        schemaVersion: 4,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        formState: {},
        manifestYaml: "",
      });
      const a = mk("11111111-1111-4111-8111-111111111111", "a");
      const b = mk("22222222-2222-4222-8222-222222222222", "b");
      const c = mk("33333333-3333-4333-8333-333333333333", "c");
      must(await projects.createProjectRecord(a));
      must(await projects.createProjectRecord(b));
      must(await projects.createProjectRecord(c));

      const d = mk("44444444-4444-4444-8444-444444444444", "d");
      d.updatedAt = 1_700_000_002_000;
      must(await projects.saveProjects([b, a, d]));

      const loaded = must(await projects.loadProjects());
      assert.deepEqual(
        loaded.map((p) => p.id),
        [b.id, a.id, d.id],
      );

      const withRev = await backend.db.all<{ id: string; rev: number }>(
        "SELECT id, rev FROM saved_projects WHERE owner_id = ? ORDER BY id",
        ["owner-a"],
      );
      const revs = Object.fromEntries(withRev.map((r) => [r.id, r.rev]));
      assert.equal(revs[b.id], 2);
      assert.equal(revs[a.id], 2);
      assert.equal(revs[d.id], 1);
      assert.equal(revs[c.id], undefined);

      assert.equal(must(await projects.getProject(c.id)), null);
    } finally {
      await backend.close();
    }
  });

  it("the payload round-trips as the same JSON value", async () => {
    const backend = await openBackend(kind);
    try {
      const projects = backend.store.projectsFor("owner-a");
      const proj: SavedProject = {
        id: "11111111-1111-4111-8111-111111111111",
        name: "round-trip",
        schemaVersion: 4,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        formState: {
          nested: { a: 1, b: [null, 2, "text"] },
          float: 1.5,
          long: "x".repeat(5000),
          unicode: "naïve Ünïcode ✓ 日本",
        },
        manifestYaml: "",
      };
      must(await projects.createProjectRecord(proj));
      const loaded = must(await projects.getProject(proj.id));
      assert.deepEqual(loaded, proj);
    } finally {
      await backend.close();
    }
  });
});
