// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";
import type { PgMigration } from "../pg-migrations/index";
import { PG_MIGRATIONS } from "../pg-migrations/index";
import {
  runPgMigrations,
  checksumOf,
  transactionControlIn,
} from "../pg-migrate";
import { createTestPgDb } from "../../../test-support/pg-test-db";

const EXPECTED_TABLES = [
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
  "saved_projects",
  "run_events",
  "orgs",
  "org_members",
  "org_invites",
  "teams",
  "team_members",
  "audit_log",
  "project_shares",
  "model_prices",
  "project_owner_state",
  "owner_documents",
  "owner_document_revs",
  "entitlements",
  "scan_records",
  "repair_runs",
  "repair_attempts",
  "byok_key_metadata",
  "byok_revocations",
];

describe("pg-migrate", () => {
  let pool: Pool;
  let drop: () => Promise<void>;

  beforeEach(async () => {
    const result = await createTestPgDb({ empty: true });
    pool = result.pool;
    drop = result.drop;
  });

  afterEach(async () => {
    await drop();
  });

  it("a fresh database gets all migrations and all tables", async () => {
    const { applied } = await runPgMigrations(pool);
    expect(applied).toEqual(PG_MIGRATIONS.map((m) => m.version));

    const m = await pool.query<{
      version: number;
      name: string;
    }>("SELECT version, name FROM schema_migrations ORDER BY version");
    expect(m.rows).toHaveLength(3);
    expect(m.rows[0]).toMatchObject({ version: 1, name: "initial" });
    expect(m.rows[1]).toMatchObject({
      version: 2,
      name: "owner_document_revs_and_audit_detail",
    });
    expect(m.rows[2]).toMatchObject({ version: 3, name: "byok" });

    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'schema_migrations'",
    );
    const names = tables.rows.map((r) => r.tablename).sort();
    expect(names).toEqual([...EXPECTED_TABLES].sort());
  });

  it("migration 0002 backfills owner_document_revs from existing documents", async () => {
    // Apply only 0001: schema exists but owner_document_revs does not.
    const first = await runPgMigrations(pool, [PG_MIGRATIONS[0]]);
    expect(first.applied).toEqual([1]);

    // A document at rev 4 for (o-1, u-1). project_id is NULL, so the FK to
    // saved_projects is not exercised and no project row is needed.
    const now = new Date().toISOString();
    await pool.query(
      "INSERT INTO owner_documents (owner_id, user_id, kind, id, project_id, rev, payload, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      ["o-1", "u-1", "workspace", "doc-1", null, 4, "{}", now],
    );

    // Running the full list now applies 0002, which creates the counter table
    // and backfills last_rev = MAX(rev) per author.
    const second = await runPgMigrations(pool);
    expect(second.applied).toEqual([2, 3]);

    const row = await pool.query<{ last_rev: number }>(
      "SELECT last_rev FROM owner_document_revs WHERE owner_id = $1 AND user_id = $2",
      ["o-1", "u-1"],
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].last_rev).toBe(4);
  });

  it("a second run applies nothing", async () => {
    await runPgMigrations(pool);
    const { applied } = await runPgMigrations(pool);
    expect(applied).toEqual([]);
  });

  it("two runs started together apply once and both resolve", async () => {
    const results = await Promise.all([
      runPgMigrations(pool),
      runPgMigrations(pool),
    ]);
    const allApplied = results.flatMap((r) => r.applied);
    expect(allApplied.filter((v) => v === 1)).toHaveLength(1);
    expect(results).toHaveLength(2);
  });

  it("a changed checksum is refused and names the version", async () => {
    await runPgMigrations(pool);
    const modified: PgMigration[] = PG_MIGRATIONS.map((m) =>
      m.version === 1 ? { ...m, sql: "SELECT 42;" } : m,
    );
    await expect(runPgMigrations(pool, modified)).rejects.toThrow("version 1");
  });

  it("a database with a version the build does not know is refused", async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      "INSERT INTO schema_migrations (version, name, checksum) VALUES (999, 'future', 'abc')",
    );
    await expect(runPgMigrations(pool)).rejects.toThrow(
      "older than the database",
    );
  });

  it("a migration list with a gap is refused", async () => {
    const gap: PgMigration[] = [
      { version: 1, name: "first", sql: "SELECT 1;" },
      { version: 3, name: "third", sql: "SELECT 3;" },
    ];
    await expect(runPgMigrations(pool, gap)).rejects.toThrow("sequence");
  });

  it("a failing transactional migration leaves no table and no row", async () => {
    const failing: PgMigration[] = [
      {
        version: 1,
        name: "fails",
        sql: "CREATE TABLE fail_test_t (id integer); SELECT * FROM pg_this_table_does_not_exist;",
      },
    ];
    await expect(runPgMigrations(pool, failing)).rejects.toBeDefined();

    const tables = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fail_test_t'",
    );
    expect(tables.rows).toHaveLength(0);

    const m = await pool.query("SELECT version FROM schema_migrations");
    expect(m.rows).toHaveLength(0);
  });

  it("a transactional: false migration is recorded", async () => {
    const nonTx: PgMigration[] = [
      {
        version: 1,
        name: "init",
        sql: "CREATE TABLE non_tx_test (id integer)",
        transactional: false,
      },
    ];
    const { applied } = await runPgMigrations(pool, nonTx);
    expect(applied).toEqual([1]);

    const tables = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'non_tx_test'",
    );
    expect(tables.rows).toHaveLength(1);

    const m = await pool.query<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations WHERE version = 1",
    );
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ version: 1, name: "init" });
  });

  it("checksumOf normalises BOM and CRLF to the same hash", () => {
    const lf = "CREATE TABLE t (id integer)\n";
    const crlf = "CREATE TABLE t (id integer)\r\n";
    const bomCrlf = "\uFEFF" + crlf;
    expect(checksumOf(lf)).toBe(checksumOf(crlf));
    expect(checksumOf(lf)).toBe(checksumOf(bomCrlf));
  });

  it("a CRLF variant applies nothing against an LF-migrated database", async () => {
    const lfSql = "CREATE TABLE norm_test (id integer)";
    await runPgMigrations(pool, [{ version: 1, name: "init", sql: lfSql }]);
    const crlfSql = lfSql.replace(/\n/g, "\r\n");
    const { applied } = await runPgMigrations(pool, [
      { version: 1, name: "init", sql: crlfSql },
    ]);
    expect(applied).toEqual([]);
  });

  it("an applied set that is not 1..k is refused", async () => {
    const migrations: PgMigration[] = [
      { version: 1, name: "first", sql: "SELECT 1;" },
      { version: 2, name: "second", sql: "SELECT 2;" },
      { version: 3, name: "third", sql: "SELECT 3;" },
    ];
    await pool.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    await pool.query(
      "INSERT INTO schema_migrations (version, name, checksum) VALUES (3, 'third', $1)",
      [checksumOf("SELECT 3;")],
    );
    await expect(runPgMigrations(pool, migrations)).rejects.toThrow(
      "1 is missing",
    );
  });

  it("a non-transactional migration with more than one statement is refused", async () => {
    const multi: PgMigration[] = [
      {
        version: 1,
        name: "init",
        sql: "CREATE TABLE t1 (id integer); CREATE TABLE t2 (id integer)",
        transactional: false,
      },
    ];
    await expect(runPgMigrations(pool, multi)).rejects.toThrow(
      "non-transactional",
    );
  });

  it("a transactional migration containing BEGIN or COMMIT is refused", async () => {
    const withBegin: PgMigration[] = [
      { version: 1, name: "init", sql: "CREATE TABLE t (id integer); BEGIN;" },
    ];
    await expect(runPgMigrations(pool, withBegin)).rejects.toThrow("BEGIN");
  });

  it("END, ROLLBACK, ABORT, START TRANSACTION and COMMIT AND CHAIN are refused too, and nothing is created", async () => {
    for (const control of [
      "END",
      "ROLLBACK",
      "ABORT",
      "START TRANSACTION",
      "COMMIT AND CHAIN",
      "commit",
    ]) {
      const leaky: PgMigration[] = [
        {
          version: 1,
          name: "init",
          sql: `CREATE TABLE leaked_t (id integer); ${control}; SELECT * FROM missing_t;`,
        },
      ];
      await expect(runPgMigrations(pool, leaky), control).rejects.toThrow(
        "transaction control statement",
      );
    }
    const left = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'leaked_t'",
    );
    expect(left.rowCount).toBe(0);
  });

  it("a plpgsql body's BEGIN … END, a CASE … END and the words in a literal or a comment are not transaction control", () => {
    expect(
      transactionControlIn(
        "CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $fn$\nBEGIN\n  IF true THEN RETURN NEW; END IF;\n  RETURN NEW;\nEND;\n$fn$;",
      ),
    ).toBeNull();
    expect(
      transactionControlIn(
        "SELECT CASE WHEN true THEN 1 END; -- COMMIT;\nSELECT 'x; ROLLBACK;'; /* ; END; */",
      ),
    ).toBeNull();
    expect(transactionControlIn("SELECT 1;\n  rollback ;")).toBe("ROLLBACK");
  });
});
