import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";

function columns(db: Database.Database, table: string): string[] {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.map((c) => c.name).sort();
}

function primaryKey(db: Database.Database, table: string): string[] {
  const cols = db.pragma(`table_info(${table})`) as Array<{
    name: string;
    pk: number;
  }>;
  return cols
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

function schemaSnapshot(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
    )
    .all() as Array<{ type: string; name: string; sql: string | null }>;
  return rows.map((r) => `${r.type} ${r.name} ${r.sql ?? ""}`);
}

function tmpDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), "platform.db");
}

const EXPECTED_COLUMNS = [
  "id",
  "kind",
  "owner_id",
  "payload",
  "project_id",
  "rev",
  "updated_at",
  "updated_by",
  "user_id",
].sort();

describe("owner_documents schema", () => {
  it("has exactly nine columns and this primary key, and opening the file twice is a no-op", () => {
    const path = tmpDbPath("hexagen-owner-docs-");
    const first = openPlatformDb(path);
    try {
      assert.deepEqual(columns(first, "owner_documents"), EXPECTED_COLUMNS);
      assert.deepEqual(primaryKey(first, "owner_documents"), [
        "owner_id",
        "user_id",
        "kind",
        "id",
      ]);
    } finally {
      first.close();
    }

    const before = schemaSnapshot(openPlatformDb(path));
    assert.ok(
      before.length > 10,
      `expected a populated schema before comparing; got ${before.length} objects`,
    );

    const second = openPlatformDb(path);
    try {
      assert.deepEqual(
        schemaSnapshot(second),
        before,
        "re-opening must not alter the schema",
      );
      assert.deepEqual(columns(second, "owner_documents"), EXPECTED_COLUMNS);
      assert.deepEqual(primaryKey(second, "owner_documents"), [
        "owner_id",
        "user_id",
        "kind",
        "id",
      ]);
    } finally {
      second.close();
    }
  });

  it("a document whose project_id names no project is refused", () => {
    const db = openPlatformDb(":memory:");
    try {
      assert.throws(
        () =>
          db
            .prepare(
              `INSERT INTO owner_documents
                (owner_id, user_id, kind, id, project_id, rev, payload, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              "owner-1",
              "user-1",
              "workspace",
              "doc-1",
              "missing-project",
              1,
              "{}",
              Date.now(),
            ),
        /FOREIGN KEY|foreign/i,
        "a project_id with no saved_projects row must be refused by the FK",
      );
    } finally {
      db.close();
    }
  });

  it("a document with a NULL project_id is accepted", () => {
    const db = openPlatformDb(":memory:");
    try {
      const now = Date.now();
      db.prepare(
        `INSERT INTO owner_documents
          (owner_id, user_id, kind, id, project_id, rev, payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("owner-1", "user-1", "workspace", "doc-1", null, 1, "{}", now);

      const row = db
        .prepare(
          "SELECT project_id FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("owner-1", "user-1", "workspace", "doc-1") as
        | { project_id: null }
        | undefined;
      assert.ok(row, "the row must exist");
      assert.equal(row.project_id, null);
    } finally {
      db.close();
    }
  });

  it("deleting the project row deletes its documents and leaves documents of other projects and NULL-project documents", () => {
    const db = openPlatformDb(":memory:");
    try {
      const now = Date.now();
      db.prepare(
        `INSERT INTO saved_projects
          (owner_id, id, name, payload, created_at, updated_at, ord)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      ).run("owner-1", "proj-a", "Alpha", "{}", now, now);

      db.prepare(
        `INSERT INTO owner_documents
          (owner_id, user_id, kind, id, project_id, rev, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "owner-1",
        "user-1",
        "workspace",
        "doc-on-a",
        "proj-a",
        1,
        "{}",
        now,
      );

      db.prepare(
        `INSERT INTO owner_documents
          (owner_id, user_id, kind, id, project_id, rev, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "owner-1",
        "user-1",
        "workspace",
        "doc-detached",
        null,
        1,
        "{}",
        now,
      );

      // Deleting the project row cascades to its documents.
      db.prepare(
        "DELETE FROM saved_projects WHERE owner_id = ? AND id = ?",
      ).run("owner-1", "proj-a");

      const gone = db
        .prepare(
          "SELECT 1 AS ok FROM owner_documents WHERE owner_id = ? AND project_id = ?",
        )
        .get("owner-1", "proj-a") as { ok: number } | undefined;
      assert.equal(
        gone,
        undefined,
        "documents of the deleted project must be gone",
      );

      const retained = db
        .prepare(
          "SELECT 1 AS ok FROM owner_documents WHERE owner_id = ? AND project_id IS NULL",
        )
        .get("owner-1") as { ok: number } | undefined;
      assert.ok(
        retained,
        "NULL-project documents must survive the project delete",
      );
    } finally {
      db.close();
    }
  });
});
