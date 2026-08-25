import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";

const ORG_TABLES = ["orgs", "org_members", "org_invites"] as const;

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

function columns(db: Database.Database, table: string): string[] {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.map((c) => c.name).sort();
}

function tmpDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), "platform.db");
}

describe("H1.1 — orgs schema", () => {
  it("creates orgs, org_members and org_invites on a fresh database", () => {
    const db = openPlatformDb(tmpDbPath("hexagen-orgs-fresh-"));
    try {
      for (const table of ORG_TABLES) {
        const row = db
          .prepare(
            "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table);
        assert.ok(row, `${table} must exist`);
      }
      assert.deepEqual(columns(db, "orgs"), [
        "created_at",
        "created_by",
        "id",
        "name",
        "slug",
      ]);
      assert.deepEqual(columns(db, "org_members"), [
        "created_at",
        "org_id",
        "role",
        "user_id",
      ]);
      assert.deepEqual(columns(db, "org_invites"), [
        "accepted_at",
        "created_at",
        "github_login",
        "invited_by",
        "org_id",
        "role",
      ]);
    } finally {
      db.close();
    }
  });

  it("org_members is keyed on (org_id, user_id)", () => {
    const db = openPlatformDb(tmpDbPath("hexagen-orgs-pk-"));
    try {
      const pk = (
        db.pragma("table_info(org_members)") as Array<{
          name: string;
          pk: number;
        }>
      )
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      assert.deepEqual(pk, ["org_id", "user_id"]);
    } finally {
      db.close();
    }
  });

  it("re-opening an existing database is a no-op (idempotent migration)", () => {
    const path = tmpDbPath("hexagen-orgs-idem-");

    const first = openPlatformDb(path);
    const before = schemaSnapshot(first);
    // Non-vacuity: a snapshot of nothing would compare equal to itself and
    // this test would pass over an empty database.
    assert.ok(
      before.length > 10,
      `expected a populated schema before comparing; got ${before.length} objects`,
    );
    assert.ok(
      ORG_TABLES.every((t) => before.some((o) => o.includes(` ${t} `))),
      "the org tables must be present in the first snapshot",
    );
    first
      .prepare(
        "INSERT INTO orgs (id, slug, name, created_by, created_at) VALUES (?,?,?,?,?)",
      )
      .run("org-1", "acme", "Acme", "user-1", new Date().toISOString());
    first.close();

    const second = openPlatformDb(path);
    try {
      assert.deepEqual(
        schemaSnapshot(second),
        before,
        "re-opening must not alter the schema",
      );
      const row = second
        .prepare("SELECT slug FROM orgs WHERE id = ?")
        .get("org-1") as { slug: string } | undefined;
      assert.equal(row?.slug, "acme", "existing rows must survive");
    } finally {
      second.close();
    }
  });

  it("org_members.org_id is a foreign key to orgs", () => {
    const db = openPlatformDb(tmpDbPath("hexagen-orgs-fk-"));
    try {
      const fks = db.pragma("foreign_key_list(org_members)") as Array<{
        table: string;
        from: string;
        to: string;
      }>;
      assert.ok(
        fks.some(
          (fk) => fk.table === "orgs" && fk.from === "org_id" && fk.to === "id",
        ),
        `expected org_members.org_id → orgs.id; got ${JSON.stringify(fks)}`,
      );
      const now = new Date().toISOString();
      assert.throws(
        () =>
          db
            .prepare(
              "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?,?,?,?)",
            )
            .run("not-an-org", "user-1", "member", now),
        /FOREIGN KEY/,
        "membership for a missing org must not insert",
      );
    } finally {
      db.close();
    }
  });

  it("refuses an org id that already belongs to a user", () => {
    const db = openPlatformDb(tmpDbPath("hexagen-orgs-collide-"));
    try {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO users (id, name, email, email_verified, image, created_at) VALUES (?,?,?,?,?,?)",
      ).run("victim", "Victim", "victim@example.com", null, null, now);
      assert.throws(
        () =>
          db
            .prepare(
              "INSERT INTO orgs (id, slug, name, created_by, created_at) VALUES (?,?,?,?,?)",
            )
            .run("victim", "takeover", "Takeover", "attacker", now),
        /collides with an existing user/,
      );
    } finally {
      db.close();
    }
  });

  it("org slugs are unique", () => {
    const db = openPlatformDb(tmpDbPath("hexagen-orgs-slug-"));
    try {
      const insert = db.prepare(
        "INSERT INTO orgs (id, slug, name, created_by, created_at) VALUES (?,?,?,?,?)",
      );
      const now = new Date().toISOString();
      insert.run("org-1", "acme", "Acme", "user-1", now);
      assert.throws(
        () => insert.run("org-2", "acme", "Acme Two", "user-1", now),
        /UNIQUE/,
      );
    } finally {
      db.close();
    }
  });
});
