// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openPlatformDb } from "../platform-db";
import { createTestPgDb } from "../../../test-support/pg-test-db";
import type { PlatformDb } from "../db";

// Read the SQLite schema once — openPlatformDb(":memory:") builds all 20
// tables in their final post-migrate shapes.
const sqliteHandle = openPlatformDb(":memory:");
const sqliteTables = sqliteHandle
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )
  .all() as { name: string }[];

function sqliteColumns(table: string): Array<{
  name: string;
  type: string;
  notnull: number;
  pk: number;
}> {
  return sqliteHandle.pragma(`table_info(${table})`) as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;
}

// The three type lists from item 5 of the brief.
const timestamptzColumns = [
  "users.created_at",
  "users.email_verified",
  "users.onboarded_at",
  "sessions.expires",
  "verification_tokens.expires",
  "orgs.created_at",
  "org_members.created_at",
  "org_invites.created_at",
  "org_invites.expires_at",
  "org_invites.accepted_at",
  "teams.created_at",
  "team_members.created_at",
  "audit_log.created_at",
  "project_shares.created_at",
  "project_shares.revoked_at",
  "saved_projects.created_at",
  "saved_projects.updated_at",
  "run_events.created_at",
  "model_prices.updated_at",
  "owner_documents.updated_at",
  "entitlements.current_period_end",
  "entitlements.updated_at",
  "scan_records.created_at",
  "repair_runs.created_at",
  "repair_attempts.created_at",
];

const booleanColumns = [
  "run_events.served_from_cache",
  "run_events.used_llm",
  "repair_attempts.eligible",
  "repair_attempts.applied",
  "repair_attempts.changed_yaml",
  "project_owner_state.initialized",
];

const jsonbColumns = [
  "saved_projects.payload",
  "owner_documents.payload",
  "scan_records.findings_sample",
  "audit_log.detail",
];

describe("pg-schema", () => {
  let db: PlatformDb;
  let drop: () => Promise<void>;

  beforeEach(async () => {
    const result = await createTestPgDb();
    db = result.db;
    drop = result.drop;
  });

  afterEach(async () => {
    await db.close();
    await drop();
  });

  it("every SQLite table and column exists in Postgres, with matching nullability and type", async () => {
    // A discovery query that returned nothing would make every loop below pass
    // without asserting anything.
    expect(sqliteTables.length).toBe(21);
    for (const table of sqliteTables) {
      expect(sqliteColumns(table.name).length).toBeGreaterThan(0);
      for (const col of sqliteColumns(table.name)) {
        const fullCol = `${table.name}.${col.name}`;
        const row = await db.get<{
          column_name: string;
          is_nullable: string;
          data_type: string;
        }>(
          "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
          [table.name, col.name],
        );
        expect(row, `Postgres is missing ${fullCol}`).toBeDefined();

        // (i) nullability: SQLite notnull or pk membership vs is_nullable
        const sqliteNotNull = col.notnull === 1 || col.pk > 0;
        expect(row!.is_nullable, `${fullCol} nullability mismatch`).toBe(
          sqliteNotNull ? "NO" : "YES",
        );

        // (ii) type mapping
        const inTs = timestamptzColumns.includes(fullCol);
        const inBool = booleanColumns.includes(fullCol);
        const inJson = jsonbColumns.includes(fullCol);
        const sqliteType = col.type.toUpperCase();
        if (inTs) {
          expect(row!.data_type, `${fullCol} should be timestamptz`).toBe(
            "timestamp with time zone",
          );
        } else if (inBool) {
          expect(row!.data_type, `${fullCol} should be boolean`).toBe(
            "boolean",
          );
        } else if (inJson) {
          expect(row!.data_type, `${fullCol} should be jsonb`).toBe("jsonb");
        } else if (sqliteType === "TEXT") {
          expect(row!.data_type, `${fullCol} should be text`).toBe("text");
        } else if (sqliteType === "INTEGER") {
          expect(
            row!.data_type === "integer" || row!.data_type === "bigint",
            `${fullCol} should be integer or bigint, got ${row!.data_type}`,
          ).toBe(true);
        } else if (sqliteType === "REAL") {
          expect(row!.data_type, `${fullCol} should be double precision`).toBe(
            "double precision",
          );
        }
      }
    }
  });

  it("index names and WHERE clauses match SQLite", async () => {
    const sqliteIndexes = sqliteHandle
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string; sql: string }>;

    const pgIndexes = await db.all<{
      indexname: string;
      indexdef: string;
    }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey'",
    );

    const sqliteNames = new Set(sqliteIndexes.map((i) => i.name));
    const pgNames = new Set(pgIndexes.map((i) => i.indexname));

    for (const name of sqliteNames) {
      expect(pgNames.has(name), `Postgres is missing index ${name}`).toBe(true);
    }

    for (const idx of sqliteIndexes) {
      const pgIdx = pgIndexes.find((i) => i.indexname === idx.name);
      if (pgIdx) {
        const sqliteHasWhere = idx.sql.includes("WHERE");
        const pgHasWhere = pgIdx.indexdef.includes("WHERE");
        expect(
          pgHasWhere,
          `index ${idx.name}: SQLite WHERE=${sqliteHasWhere}, Postgres WHERE=${pgHasWhere}`,
        ).toBe(sqliteHasWhere);
      }
    }
  });

  it("time columns have type timestamp with time zone", async () => {
    for (const col of timestamptzColumns) {
      const [table, column] = col.split(".");
      const row = await db.get<{ data_type: string }>(
        "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
        [table, column],
      );
      expect(row?.data_type, `${col} should be timestamptz`).toBe(
        "timestamp with time zone",
      );
    }
  });

  it("flag columns have type boolean", async () => {
    for (const col of booleanColumns) {
      const [table, column] = col.split(".");
      const row = await db.get<{ data_type: string }>(
        "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
        [table, column],
      );
      expect(row?.data_type, `${col} should be boolean`).toBe("boolean");
    }
  });

  it("json columns have type jsonb", async () => {
    for (const col of jsonbColumns) {
      const [table, column] = col.split(".");
      const row = await db.get<{ data_type: string }>(
        "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
        [table, column],
      );
      expect(row?.data_type, `${col} should be jsonb`).toBe("jsonb");
    }
  });

  it("the two id-collision triggers reject with the SQLite message text", async () => {
    const now = new Date().toISOString();

    // org_id_not_user_id: inserting an org with an id that already exists in users
    await db.run(
      "INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)",
      ["col-1", "U", "u@t", now],
    );
    await expect(
      db.run(
        "INSERT INTO orgs (id, slug, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
        ["col-1", "s1", "O", "u@t", now],
      ),
    ).rejects.toThrow("org id collides with an existing user");

    // user_id_not_org_id: inserting a user with an id that already exists in orgs
    await db.run(
      "INSERT INTO orgs (id, slug, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      ["col-2", "s2", "O2", "u@t", now],
    );
    await expect(
      db.run(
        "INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)",
        ["col-2", "U2", "u2@t", now],
      ),
    ).rejects.toThrow("user id collides with an existing org");
  });

  it("owner_documents rows go when their project row is deleted", async () => {
    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO saved_projects (id, owner_id, name, payload, created_at, updated_at, ord, rev) VALUES (@id, @oid, @name, @payload, @created, @updated, @ord, @rev)",
      {
        id: "p1",
        oid: "own1",
        name: "P",
        payload: "{}",
        created: now,
        updated: now,
        ord: 1,
        rev: 1,
      },
    );
    await db.run(
      "INSERT INTO owner_documents (owner_id, user_id, kind, id, project_id, rev, payload, updated_at) VALUES (@oid, @uid, @kind, @id, @pid, @rev, @payload, @at)",
      {
        oid: "own1",
        uid: "u1",
        kind: "k1",
        id: "d1",
        pid: "p1",
        rev: 1,
        payload: "{}",
        at: now,
      },
    );
    await db.run(
      "DELETE FROM saved_projects WHERE owner_id = @oid AND id = @id",
      {
        oid: "own1",
        id: "p1",
      },
    );
    const doc = await db.get(
      "SELECT * FROM owner_documents WHERE owner_id = @oid AND id = @id",
      { oid: "own1", id: "d1" },
    );
    expect(doc).toBeUndefined();
  });

  it("0002 and 0003 are applied (schema_migrations has versions 1, 2 and 3)", async () => {
    const versions = await db.all<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3]);
    // And A3-00's Postgres-only objects exist on the migrated test database.
    const cols = await db.all<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'detail'",
    );
    expect(cols).toHaveLength(1);
    const tables = await db.all<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'owner_document_revs'",
    );
    expect(tables).toHaveLength(1);
  });

  it("an upper-case github_login is refused by the CHECK (23514)", async () => {
    let err: unknown;
    try {
      await db.run(
        "INSERT INTO users (id, name, email, github_login, created_at) VALUES (@id, @name, @email, @login, @at)",
        {
          id: "upper-1",
          name: "N",
          email: "u@t",
          login: "UpperCase",
          at: new Date().toISOString(),
        },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect((err as { code?: string }).code).toBe("23514");
  });

  it("saved_projects.rev defaults to 1", async () => {
    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO saved_projects (id, owner_id, name, payload, created_at, updated_at, ord) VALUES (@id, @oid, @name, @payload, @created, @updated, @ord)",
      {
        id: "p1",
        oid: "own1",
        name: "P",
        payload: "{}",
        created: now,
        updated: now,
        ord: 1,
      },
    );
    const row = await db.get<{ rev: number }>(
      "SELECT rev FROM saved_projects WHERE owner_id = @oid AND id = @id",
      { oid: "own1", id: "p1" },
    );
    expect(row?.rev).toBe(1);
  });

  it("scan_records.rowid increases with insertion order", async () => {
    const now = new Date().toISOString();
    const cols =
      "(id, owner_id, schema_version, project_name, tier, verdict, findings_fresh, findings_baselined, findings_stale, findings_expired, findings_sample, created_at)";
    const vals =
      "@id, @oid, @sv, @pn, @tier, @ver, @ff, @fb, @fs, @fe, @sample, @at";
    await db.run(`INSERT INTO scan_records ${cols} VALUES (${vals})`, {
      id: "s1",
      oid: "own1",
      sv: 1,
      pn: "test",
      tier: "full",
      ver: "ok",
      ff: 0,
      fb: 0,
      fs: 0,
      fe: 0,
      sample: "{}",
      at: now,
    });
    await db.run(`INSERT INTO scan_records ${cols} VALUES (${vals})`, {
      id: "s2",
      oid: "own1",
      sv: 1,
      pn: "test",
      tier: "full",
      ver: "ok",
      ff: 0,
      fb: 0,
      fs: 0,
      fe: 0,
      sample: "{}",
      at: now,
    });
    const rows = await db.all<{ id: string; rowid: number }>(
      "SELECT id, rowid FROM scan_records ORDER BY id",
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].rowid).toBeGreaterThan(rows[0].rowid);
  });
});
