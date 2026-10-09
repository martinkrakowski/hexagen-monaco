// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";
import type { PgMigration } from "../pg-migrations/index";
import { runPgMigrations } from "../pg-migrate";
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
  "entitlements",
  "scan_records",
  "repair_runs",
  "repair_attempts",
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

  it("a fresh database gets version 1 and all tables", async () => {
    const { applied } = await runPgMigrations(pool);
    expect(applied).toEqual([1]);

    const m = await pool.query<{
      version: number;
      name: string;
    }>("SELECT version, name FROM schema_migrations ORDER BY version");
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ version: 1, name: "initial" });

    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'schema_migrations'",
    );
    const names = tables.rows.map((r) => r.tablename).sort();
    expect(names).toEqual([...EXPECTED_TABLES].sort());
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
    const modified: PgMigration[] = [
      { version: 1, name: "initial", sql: "SELECT 42;" },
    ];
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
});
