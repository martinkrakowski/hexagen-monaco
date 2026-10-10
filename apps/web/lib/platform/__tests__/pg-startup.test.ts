// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Pool } from "pg";
import {
  runStartupMigrations,
  startPlatformMigrations,
} from "../pg-startup";
import { createTestPgDb } from "../../../test-support/pg-test-db";

describe("pg-startup migrations", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let url: string;

  beforeEach(async () => {
    const result = await createTestPgDb({ empty: true });
    pool = result.pool;
    drop = result.drop;
    url = result.url;
  });

  afterEach(async () => {
    await drop();
  });

  it("an empty database is migrated: version 1 is recorded and the schema exists", async () => {
    const { applied } = await runStartupMigrations(url);
    expect(applied).toEqual([1, 2, 3]);

    const m = await pool.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(m.rows.map((r) => r.version)).toEqual([1, 2, 3]);

    const r = await pool.query<{ to_regclass: string | null }>(
      "SELECT to_regclass('public.users') AS to_regclass",
    );
    expect(r.rows[0].to_regclass).not.toBeNull();
  });

  it("a second run applies nothing", async () => {
    await runStartupMigrations(url);
    const { applied } = await runStartupMigrations(url);
    expect(applied).toEqual([]);
  });

  it("two start-ups at once apply once and both resolve", async () => {
    const results = await Promise.all([
      runStartupMigrations(url),
      runStartupMigrations(url),
    ]);
    const allApplied = results.flatMap((r) => r.applied);
    expect(results).toHaveLength(2);
    expect(allApplied.sort()).toEqual([1, 2, 3]);
  });

  it("a database newer than this build is refused and the process would exit", async () => {
    await runStartupMigrations(url);
    await pool.query(
      "INSERT INTO schema_migrations (version, name, checksum) VALUES (999, 'future', 'x')",
    );
    const exit = vi.fn();
    const errors: string[] = [];
    const log = {
      info: vi.fn(),
      error: vi.fn((...args: unknown[]) => errors.push(args.join(" "))),
    };
    await startPlatformMigrations({ DATABASE_URL: url }, { exit, log });

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    const line = errors[0];
    expect(line).toContain("999");
    expect(line).toContain("sqlstate=none");
    expect(line).toContain("1..3");
  });
});

describe("pg-startup selection behaviour", () => {
  it.each([{}, { DATABASE_URL: "   " }])(
    "no DATABASE_URL: nothing runs for %p",
    async (env) => {
      const run = vi.fn();
      const exit = vi.fn();
      const log = { info: vi.fn(), error: vi.fn() };
      await startPlatformMigrations(
        env as NodeJS.ProcessEnv,
        { run, exit, log },
      );
      expect(run).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
    },
  );

  it("the URL never reaches the log", async () => {
    const url = "postgres://user:secret@db.example/hx";
    const run = vi.fn().mockRejectedValue(
      new Error(`could not connect to ${url}`),
    );
    const exit = vi.fn();
    const errors: string[] = [];
    const log = {
      info: vi.fn(),
      error: vi.fn((...args: unknown[]) => errors.push(args.join(" "))),
    };
    await startPlatformMigrations({ DATABASE_URL: url }, { run, exit, log });

    const line = errors[0];
    expect(line).toContain("[DATABASE_URL]");
    expect(line).not.toContain("secret");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a failing migration exits with its SQLSTATE", async () => {
    const run = vi.fn().mockRejectedValue({ code: "42P07", message: "boom" });
    const exit = vi.fn();
    const errors: string[] = [];
    const log = {
      info: vi.fn(),
      error: vi.fn((...args: unknown[]) => errors.push(args.join(" "))),
    };
    await startPlatformMigrations(
      { DATABASE_URL: "postgres://dummy" },
      { run, exit, log },
    );

    expect(errors[0]).toContain("sqlstate=42P07");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
