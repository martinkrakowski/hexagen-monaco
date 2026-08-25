import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openPlatformDb } from "../platform-db";

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "hexagen-teams-schema-")), "p.db");
}

/**
 * P-A2 schema. The migration runs against a LIVE production volume, so
 * "idempotent" is asserted over a schema that is verified non-empty first —
 * a snapshot of nothing trivially equals itself.
 */
describe("P-A2 — teams schema", () => {
  it("creates teams, team_members and audit_log on a fresh database", () => {
    const db = openPlatformDb(tempDbPath());
    try {
      const names = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name);

      // Non-vacuity: the whole platform schema is present, not just our three.
      assert.ok(
        names.length > 10,
        `expected a populated schema, found ${names.length} tables`,
      );
      for (const t of ["teams", "team_members", "audit_log"]) {
        assert.ok(names.includes(t), `missing table ${t}: ${names.join(", ")}`);
      }
    } finally {
      db.close();
    }
  });

  it("team_members is keyed on (team_id, user_id)", () => {
    const db = openPlatformDb(tempDbPath());
    try {
      const pk = (
        db.prepare("PRAGMA table_info(team_members)").all() as Array<{
          name: string;
          pk: number;
        }>
      )
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      assert.deepEqual(pk, ["team_id", "user_id"]);
    } finally {
      db.close();
    }
  });

  it("re-opening an existing database is a no-op (idempotent migration)", () => {
    const path = tempDbPath();
    const first = openPlatformDb(path);
    const snapshot = () =>
      (
        first
          .prepare(
            "SELECT type, name, sql FROM sqlite_master ORDER BY type, name",
          )
          .all() as Array<{ type: string; name: string; sql: string | null }>
      )
        .map((r) => `${r.type}:${r.name}:${r.sql ?? ""}`)
        .join("\n");
    const before = snapshot();
    first.close();

    // Non-vacuity before comparing: an empty schema would compare equal to
    // itself and prove nothing.
    assert.ok(before.includes("table:teams:"), "teams missing from snapshot");
    assert.ok(
      before.includes("table:team_members:"),
      "team_members missing from snapshot",
    );
    assert.ok(
      before.includes("table:audit_log:"),
      "audit_log missing from snapshot",
    );

    const second = openPlatformDb(path);
    try {
      const after = (
        second
          .prepare(
            "SELECT type, name, sql FROM sqlite_master ORDER BY type, name",
          )
          .all() as Array<{ type: string; name: string; sql: string | null }>
      )
        .map((r) => `${r.type}:${r.name}:${r.sql ?? ""}`)
        .join("\n");
      assert.equal(after, before, "second open changed the schema");
    } finally {
      second.close();
    }
  });

  it("a team slug is unique within an org, and free across orgs", () => {
    const db = openPlatformDb(tempDbPath());
    try {
      const insert = db.prepare(`
        INSERT INTO teams (id, org_id, slug, name, created_by, created_at)
        VALUES (?, ?, ?, ?, 'u', '2026-01-01T00:00:00.000Z')
      `);
      insert.run("t1", "org-a", "platform", "Platform");
      // Same slug, different org — legal: the handle is @org-slug/team-slug.
      insert.run("t2", "org-b", "platform", "Platform");
      assert.throws(
        () => insert.run("t3", "org-a", "platform", "Dup"),
        /UNIQUE/i,
      );
    } finally {
      db.close();
    }
  });
});
