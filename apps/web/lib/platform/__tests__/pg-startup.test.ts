// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Pool } from "pg";
import { runStartupMigrations, startPlatformMigrations } from "../pg-startup";
import { runPgMigrations } from "../pg-migrate";
import { PG_MIGRATIONS } from "../pg-migrations";
import { createTestPgDb } from "../../../test-support/pg-test-db";

const ALL = PG_MIGRATIONS.map((m) => m.version);

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
    expect(applied).toEqual(ALL);

    const m = await pool.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(m.rows.map((r) => r.version)).toEqual(ALL);

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
    expect(allApplied.sort()).toEqual(ALL);
  });

  it(
    "a held advisory lock fails with 55P03 instead of waiting for ever",
    { timeout: 8_000 },
    async () => {
      const holder = await pool.connect();
      try {
        // Same key as pg-migrate.ts ADVISORY_LOCK_KEY (not exported).
        await holder.query("SELECT pg_advisory_lock(7302026100801)");
        const start = Date.now();
        await expect(
          runPgMigrations(pool, PG_MIGRATIONS, { lockTimeoutMs: 300 }),
        ).rejects.toMatchObject({ code: "55P03" });
        expect(Date.now() - start).toBeLessThan(5_000);
      } finally {
        await holder.query("SELECT pg_advisory_unlock(7302026100801)");
        holder.release();
      }
      await expect(runPgMigrations(pool)).resolves.toBeDefined();
    },
  );

  it("a successful run with lockTimeoutMs leaves lock_timeout reset", async () => {
    await runPgMigrations(pool, PG_MIGRATIONS, { lockTimeoutMs: 300 });
    const client = await pool.connect();
    try {
      const r = await client.query<{ lock_timeout: string }>(
        "SHOW lock_timeout",
      );
      expect(["0", "0ms"]).toContain(r.rows[0].lock_timeout);
    } finally {
      client.release();
    }
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
    await startPlatformMigrations(
      { NODE_ENV: "test", DATABASE_URL: url },
      { exit, log },
    );

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    const line = errors[0];
    expect(line).toContain("999");
    expect(line).toContain("code=none");
    expect(line).toContain(`1..${PG_MIGRATIONS.length}`);
  });
});

describe("pg-startup selection behaviour", () => {
  const envWith = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    NODE_ENV: "test",
    ...extra,
  });

  it("no DATABASE_URL: nothing runs when the variable is absent", async () => {
    const run = vi.fn();
    const exit = vi.fn();
    const log = { info: vi.fn(), error: vi.fn() };
    await startPlatformMigrations(envWith(), { run, exit, log });
    expect(run).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("no DATABASE_URL: nothing runs when the variable is blank", async () => {
    const run = vi.fn();
    const exit = vi.fn();
    const log = { info: vi.fn(), error: vi.fn() };
    await startPlatformMigrations(envWith({ DATABASE_URL: "   " }), {
      run,
      exit,
      log,
    });
    expect(run).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("the URL never reaches the log", async () => {
    const url = "postgres://user:secret@db.example/hx";
    const run = vi
      .fn()
      .mockRejectedValue(new Error(`could not connect to ${url}`));
    const exit = vi.fn();
    const errors: string[] = [];
    const log = {
      info: vi.fn(),
      error: vi.fn((...args: unknown[]) => errors.push(args.join(" "))),
    };
    await startPlatformMigrations(envWith({ DATABASE_URL: url }), {
      run,
      exit,
      log,
    });

    expect(errors).toHaveLength(1);
    const line = errors[0];
    expect(line.length).toBeGreaterThan(0);
    expect(line).toContain("[DATABASE_URL]");
    expect(line).not.toContain("secret");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a network error code is logged as code=, not sqlstate=", async () => {
    const run = vi.fn().mockRejectedValue({
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:1",
    });
    const exit = vi.fn();
    const errors: string[] = [];
    const log = {
      info: vi.fn(),
      error: vi.fn((...args: unknown[]) => errors.push(args.join(" "))),
    };
    await startPlatformMigrations(
      envWith({ DATABASE_URL: "postgres://dummy" }),
      { run, exit, log },
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("code=ECONNREFUSED");
    expect(errors[0]).not.toContain("sqlstate");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("an AggregateError logs both inner errors' codes and messages", async () => {
    const inner1 = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:1"),
      { code: "ECONNREFUSED" },
    );
    const inner2 = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:2"),
      { code: "ECONNREFUSED" },
    );
    const run = vi
      .fn()
      .mockRejectedValue(new AggregateError([inner1, inner2], ""));
    const exit = vi.fn();
    const errors: string[] = [];
    const log = {
      info: vi.fn(),
      error: vi.fn((...args: unknown[]) => errors.push(args.join(" "))),
    };
    await startPlatformMigrations(
      envWith({ DATABASE_URL: "postgres://dummy" }),
      { run, exit, log },
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("connect ECONNREFUSED 127.0.0.1:1");
    expect(errors[0]).toContain("connect ECONNREFUSED 127.0.0.1:2");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("the URL is redacted in the outer and the inner error messages", async () => {
    const url = "postgres://u:s3cret-dummy@127.0.0.1:1/x";
    const inner = new Error(`could not connect to ${url}`);
    const run = vi
      .fn()
      .mockRejectedValue(
        new AggregateError([inner], `could not connect to ${url}`),
      );
    const exit = vi.fn();
    const errors: string[] = [];
    const log = {
      info: vi.fn(),
      error: vi.fn((...args: unknown[]) => errors.push(args.join(" "))),
    };
    await startPlatformMigrations(envWith({ DATABASE_URL: url }), {
      run,
      exit,
      log,
    });

    expect(errors).toHaveLength(1);
    const line = errors[0];
    expect(line).toContain("[DATABASE_URL]");
    expect(line).not.toContain(url);
    expect(line).not.toContain("s3cret-dummy");
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
      envWith({ DATABASE_URL: "postgres://dummy" }),
      { run, exit, log },
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("code=42P07");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
