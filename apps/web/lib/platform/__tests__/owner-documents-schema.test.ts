import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { createOwnerDocumentsStore } from "../owner-documents-store";

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

      // A second project with its own document: it must survive.
      db.prepare(
        `INSERT INTO saved_projects
          (owner_id, id, name, payload, created_at, updated_at, ord)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      ).run("owner-1", "proj-b", "Beta", "{}", now, now);
      db.prepare(
        `INSERT INTO owner_documents
          (owner_id, user_id, kind, id, project_id, rev, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "owner-1",
        "user-1",
        "workspace",
        "doc-on-b",
        "proj-b",
        1,
        "{}",
        now,
      );

      // Deleting the project row cascades to its documents.
      db.prepare(
        "DELETE FROM saved_projects WHERE owner_id = ? AND id = ?",
      ).run("owner-1", "proj-a");

      const other = db
        .prepare(
          "SELECT 1 AS ok FROM owner_documents WHERE owner_id = ? AND project_id = ?",
        )
        .get("owner-1", "proj-b") as { ok: number } | undefined;
      assert.ok(other, "documents of another project must survive");

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

  it("opening an old file adds audit_log.detail and owner_document_revs, backfills the counter, and is idempotent", async () => {
    // Build a file by hand with the PRE-A3-00 schema: audit_log has no `detail`
    // and owner_document_revs does not exist. Mirrors origin/main's DDL for the
    // tables that matter here.
    const path = tmpDbPath("hexagen-owner-docs-old-");
    const file = new Database(path);
    file.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, name TEXT, email TEXT, email_verified TEXT,
        image TEXT, github_login TEXT, onboarded_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE orgs (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE org_members (
        org_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (org_id, user_id),
        FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
      );
      CREATE TABLE saved_projects (
        id TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL,
        payload TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        ord INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 1, updated_by TEXT,
        PRIMARY KEY (owner_id, id)
      );
      CREATE TABLE owner_documents (
        owner_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        kind       TEXT NOT NULL,
        id         TEXT NOT NULL,
        project_id TEXT,
        rev        INTEGER NOT NULL,
        payload    TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (owner_id, user_id, kind, id),
        FOREIGN KEY (owner_id, project_id)
          REFERENCES saved_projects (owner_id, id) ON DELETE CASCADE
      );
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        subject_owner_id TEXT,
        subject_id TEXT,
        grantee_type TEXT,
        grantee_id TEXT,
        created_at TEXT NOT NULL
      );
    `);
    const now = Date.now();
    // One document at rev 4, so the backfill sets last_rev = 4.
    file
      .prepare(
        `INSERT INTO owner_documents
           (owner_id, user_id, kind, id, project_id, rev, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("user-1", "user-1", "workspace", "doc-1", null, 4, "{}", now);
    // One audit row, written before `detail` existed.
    file
      .prepare(
        `INSERT INTO audit_log
           (id, actor_id, action, subject_owner_id, subject_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "audit-1",
        "user-1",
        "document.precondition_failed",
        "user-1",
        "workspace/doc-1",
        new Date(now).toISOString(),
      );
    file.close();

    // Personal tenant (owner_id == user_id): the store skips the membership
    // check, so this test exercises only the schema migration, not orgs.
    const handle = openPlatformDb(path);
    let revAfter = 0;
    try {
      // detail column exists now, and the old audit row reads NULL.
      assert.equal(columns(handle, "audit_log").includes("detail"), true);
      assert.equal(
        columns(handle, "owner_document_revs").includes("last_rev"),
        true,
      );
      const audit = handle
        .prepare("SELECT detail FROM audit_log WHERE id = ?")
        .get("audit-1") as { detail: unknown };
      assert.equal(audit.detail, null, "old audit row reads detail NULL");

      // Backfill: last_rev = MAX(rev) = 4 for this author.
      const rev = handle
        .prepare(
          "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        )
        .get("user-1", "user-1") as { last_rev: number } | undefined;
      assert.ok(rev, "the backfill must have written a counter row");
      assert.equal(
        rev!.last_rev,
        4,
        "counter starts from the document's last rev",
      );

      // The document keeps its rev 4.
      const doc = handle
        .prepare(
          "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("user-1", "user-1", "workspace", "doc-1") as { rev: number };
      assert.equal(doc.rev, 4, "the document's own rev is untouched");

      // Next store write takes rev = max(4, counter 4) + 1 = 5.
      const platformDb = createSqlitePlatformDb(handle);
      const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
      const written = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "after" },
      });
      assert.equal(written.success, true);
      assert.equal(written.success && written.value.rev, 5);

      // Capture whatever the counter holds after the write, so a second open
      // can assert it is untouched (the backfill is idempotent).
      const revAfterRow = handle
        .prepare(
          "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        )
        .get("user-1", "user-1") as { last_rev: number };
      revAfter = revAfterRow.last_rev;
    } finally {
      handle.close();
    }

    // A second open on the same file is a no-op: schema snapshot unchanged and
    // the backfill leaves the already-correct counter untouched.
    const handle2 = openPlatformDb(path);
    try {
      assert.equal(columns(handle2, "audit_log").includes("detail"), true);
      assert.equal(
        columns(handle2, "owner_document_revs").includes("last_rev"),
        true,
      );
      const rev = handle2
        .prepare(
          "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        )
        .get("user-1", "user-1") as { last_rev: number };
      assert.equal(
        rev!.last_rev,
        revAfter,
        "a second open must not re-backfill",
      );
    } finally {
      handle2.close();
      rmSync(path, { force: true });
    }
  });
});
