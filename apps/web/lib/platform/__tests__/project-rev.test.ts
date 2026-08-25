import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";
import { createSavedProjectsStore } from "../saved-projects-store";
import type { SavedProject } from "@hexagen/shared";

function tmpDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), "platform.db");
}

const OWNER = "owner-a";

function project(id: string, name: string): SavedProject {
  return {
    id,
    name,
    createdAt: 1,
    updatedAt: 1,
    formState: {},
  } as unknown as SavedProject;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>)
    .map((c) => c.name)
    .sort();
}

/**
 * H1.4. `rev` is a monotonic counter; `updated_at` was the previous If-Match
 * value and is a clock, which is unsafe under multi-seat — two writers inside
 * one millisecond, or a clock that steps back, both make a stale write look
 * current.
 */
describe("H1.4 — saved_projects.rev and updated_by", () => {
  it("adds both columns, and re-opening the database is a no-op", () => {
    const path = tmpDbPath("hexagen-rev-idem-");
    const first = openPlatformDb(path);
    // Non-vacuity: assert the columns are THERE before asserting nothing
    // changed. A snapshot of a table that was never created equals itself.
    const before = columnNames(first, "saved_projects");
    assert.ok(before.includes("rev"), `rev missing: ${before.join(",")}`);
    assert.ok(
      before.includes("updated_by"),
      `updated_by missing: ${before.join(",")}`,
    );
    assert.ok(before.length >= 9, `too few columns: ${before.join(",")}`);
    first.close();

    const second = openPlatformDb(path);
    try {
      assert.deepEqual(columnNames(second, "saved_projects"), before);
    } finally {
      second.close();
    }
  });

  it("migrates a pre-H1.4 table without touching the rows it already holds", () => {
    const path = tmpDbPath("hexagen-rev-legacy-");
    // A database as it existed before H1.4: the composite PK is already there
    // (migrateSavedProjects), but rev/updated_by are not.
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE saved_projects (
        id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        PRIMARY KEY (owner_id, id)
      );
    `);
    const seeded = project("11111111-1111-4111-8111-111111111111", "legacy");
    legacy
      .prepare(
        `INSERT INTO saved_projects
           (id, owner_id, name, payload, created_at, updated_at, ord)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(seeded.id, OWNER, seeded.name, JSON.stringify(seeded), 1, 1, 0);
    legacy.close();

    const db = openPlatformDb(path);
    try {
      const row = db
        .prepare(
          "SELECT name, payload, rev, updated_by FROM saved_projects WHERE owner_id = ? AND id = ?",
        )
        .get(OWNER, seeded.id) as {
        name: string;
        payload: string;
        rev: number;
        updated_by: string | null;
      };
      assert.equal(row.rev, 1, "an existing row starts at rev 1");
      assert.equal(
        row.updated_by,
        null,
        "NULL means 'written before H1.4', not 'by nobody'",
      );
      assert.equal(row.name, "legacy", "the payload survives the migration");
      assert.equal(JSON.parse(row.payload).id, seeded.id);
    } finally {
      db.close();
    }
  });

  it("increments rev by exactly one per write, and stamps the actor", async () => {
    const db = openPlatformDb(tmpDbPath("hexagen-rev-bump-"));
    try {
      const store = createSavedProjectsStore(db, OWNER);
      const p = project("22222222-2222-4222-8222-222222222222", "alpha");
      await store.createProjectRecord(p);

      const readRev = () =>
        (
          db
            .prepare(
              "SELECT rev, updated_by FROM saved_projects WHERE owner_id = ? AND id = ?",
            )
            .get(OWNER, p.id) as { rev: number; updated_by: string | null }
        ).rev;

      // Non-vacuous: prove it was 1 BEFORE the write, not merely 2 after.
      assert.equal(readRev(), 1, "a fresh row starts at rev 1");

      const first = store.putProject(
        { ...p, name: "second", updatedAt: 2 },
        { rev: 1 },
        "user-writer",
      );
      assert.equal(first.success, true);
      if (first.success) assert.equal(first.value.rev, 2);
      assert.equal(readRev(), 2, "one write moves rev by exactly one");

      const stamped = db
        .prepare(
          "SELECT updated_by FROM saved_projects WHERE owner_id = ? AND id = ?",
        )
        .get(OWNER, p.id) as { updated_by: string | null };
      assert.equal(stamped.updated_by, "user-writer");

      const second = store.putProject(
        { ...p, name: "third", updatedAt: 3 },
        { rev: 2 },
        "user-writer",
      );
      assert.equal(second.success, true);
      assert.equal(readRev(), 3);
    } finally {
      db.close();
    }
  });

  it("refuses a stale rev and leaves the stored row untouched", async () => {
    const db = openPlatformDb(tmpDbPath("hexagen-rev-stale-"));
    try {
      const store = createSavedProjectsStore(db, OWNER);
      const p = project("33333333-3333-4333-8333-333333333333", "alpha");
      await store.createProjectRecord(p);

      const ok = store.putProject(
        { ...p, name: "winner", updatedAt: 2 },
        { rev: 1 },
        "user-a",
      );
      assert.equal(ok.success, true, "the first write must land");

      // A second seat still holding rev 1.
      const stale = store.putProject(
        { ...p, name: "loser", updatedAt: 3 },
        { rev: 1 },
        "user-b",
      );
      assert.equal(stale.success, false);
      if (!stale.success) assert.equal(stale.error.kind, "Conflict");

      // The payload matters, not just the status: a refusal that still wrote
      // is the lost update this whole mechanism exists to stop.
      const row = db
        .prepare(
          "SELECT name, rev, updated_by FROM saved_projects WHERE owner_id = ? AND id = ?",
        )
        .get(OWNER, p.id) as {
        name: string;
        rev: number;
        updated_by: string | null;
      };
      assert.equal(row.name, "winner", "the refused write must not clobber");
      assert.equal(row.rev, 2, "a refused write must not move rev");
      assert.equal(row.updated_by, "user-a");
    } finally {
      db.close();
    }
  });

  it("still honours the legacy updated_at precondition", async () => {
    const db = openPlatformDb(tmpDbPath("hexagen-rev-legacy-match-"));
    try {
      const store = createSavedProjectsStore(db, OWNER);
      const p = project("44444444-4444-4444-8444-444444444444", "alpha");
      await store.createProjectRecord(p);

      // A bare number is the pre-H1.4 form and must keep working, so an
      // already-loaded personal-tenant tab is not 409'd until it reloads.
      const ok = store.putProject({ ...p, name: "b", updatedAt: 2 }, 1);
      assert.equal(ok.success, true);

      const stale = store.putProject({ ...p, name: "c", updatedAt: 3 }, 1);
      assert.equal(stale.success, false);
      if (!stale.success) assert.equal(stale.error.kind, "Conflict");
    } finally {
      db.close();
    }
  });

  it("saveProjects must not reset an existing rev to 1 (ABA)", async () => {
    const db = openPlatformDb(tmpDbPath("hexagen-rev-aba-"));
    try {
      const store = createSavedProjectsStore(db, OWNER);
      const kept = project("55555555-5555-4555-8555-555555555555", "kept");
      const added = project("66666666-6666-4666-8666-666666666666", "added");
      await store.createProjectRecord(kept);

      const first = store.putProject(
        { ...kept, name: "second", updatedAt: 2 },
        { rev: 1 },
        "user-writer",
      );
      assert.equal(first.success, true, "the setup write must land");
      const second = store.putProject(
        { ...kept, name: "third", updatedAt: 3 },
        { rev: 2 },
        "user-writer",
      );
      assert.equal(second.success, true);
      assert.equal(
        (
          db
            .prepare(
              "SELECT rev FROM saved_projects WHERE owner_id = ? AND id = ?",
            )
            .get(OWNER, kept.id) as { rev: number }
        ).rev,
        3,
        "fixture must be above rev 1 before bulk replace",
      );

      const replaced = await store.saveProjects([
        { ...kept, name: "bulk", updatedAt: 4 },
        added,
      ]);
      assert.equal(replaced.success, true);

      const keptRow = db
        .prepare(
          "SELECT name, rev, updated_by FROM saved_projects WHERE owner_id = ? AND id = ?",
        )
        .get(OWNER, kept.id) as {
        name: string;
        rev: number;
        updated_by: string | null;
      };
      assert.equal(keptRow.name, "bulk");
      assert.ok(
        keptRow.rev > 3,
        `bulk replace of an existing id must increment rev, got ${keptRow.rev}`,
      );
      assert.notEqual(
        keptRow.rev,
        1,
        "delete-and-reinsert must not revive rev 1",
      );
      assert.equal(
        keptRow.updated_by,
        "user-writer",
        "bulk replace has no actor; it must preserve attribution",
      );

      const addedRow = db
        .prepare(
          "SELECT rev, updated_by FROM saved_projects WHERE owner_id = ? AND id = ?",
        )
        .get(OWNER, added.id) as { rev: number; updated_by: string | null };
      assert.equal(addedRow.rev, 1, "a genuinely new id starts at rev 1");
      assert.equal(addedRow.updated_by, null);

      const stale = store.putProject(
        { ...kept, name: "aba", updatedAt: 5 },
        { rev: 1 },
        "user-stale",
      );
      assert.equal(stale.success, false, "a pre-replace rev:1 must stay stale");
      if (!stale.success) assert.equal(stale.error.kind, "Conflict");

      const afterStale = db
        .prepare(
          "SELECT name, rev FROM saved_projects WHERE owner_id = ? AND id = ?",
        )
        .get(OWNER, kept.id) as { name: string; rev: number };
      assert.equal(afterStale.name, "bulk", "the ABA write must not clobber");
      assert.equal(afterStale.rev, keptRow.rev);
    } finally {
      db.close();
    }
  });
});
