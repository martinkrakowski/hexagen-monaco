// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";
import { createTestPgDb } from "../../../test-support/pg-test-db";
import {
  getPlatformStore,
  closePlatformStore,
  createPlatformStore,
} from "../store";

describe("store selection by DATABASE_URL", () => {
  let url: string;
  let pool: Pool;
  let drop: () => Promise<void>;
  let savedDbUrl: string | undefined;
  let savedDbPath: string | undefined;

  beforeEach(async () => {
    const result = await createTestPgDb();
    url = result.url;
    pool = result.pool;
    drop = result.drop;
    savedDbUrl = process.env.DATABASE_URL;
    savedDbPath = process.env.PLATFORM_DB_PATH;
    delete process.env.DATABASE_URL;
    delete process.env.PLATFORM_DB_PATH;
  });

  afterEach(async () => {
    await closePlatformStore();
    if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDbUrl;
    if (savedDbPath === undefined) delete process.env.PLATFORM_DB_PATH;
    else process.env.PLATFORM_DB_PATH = savedDbPath;
    await drop();
  });

  async function countPgRows() {
    const r = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM project_owner_state",
    );
    return r.rows[0].n;
  }

  it("with DATABASE_URL set, getPlatformStore writes to Postgres", async () => {
    process.env.DATABASE_URL = url;
    const store = getPlatformStore();
    await store.markProjectsInitialized("owner-1");
    const { rows } = await pool.query<{ initialized: number }>(
      "SELECT initialized FROM project_owner_state WHERE owner_id = 'owner-1'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].initialized).toBe(1);
  });

  it("without it, getPlatformStore is the SQLite store", async () => {
    process.env.DATABASE_URL = url;
    const pgStore = getPlatformStore();
    await pgStore.markProjectsInitialized("owner-1");
    expect(await countPgRows()).toBe(1);

    await closePlatformStore();
    delete process.env.DATABASE_URL;

    const sqliteStore = getPlatformStore();
    await sqliteStore.markProjectsInitialized("owner-2");

    expect(await countPgRows()).toBe(1);
  });

  it("createPlatformStore(':memory:') stays SQLite even when DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = url;
    const before = await countPgRows();
    const store = createPlatformStore(":memory:");
    await store.markProjectsInitialized("owner-3");
    await store.close();
    expect(await countPgRows()).toBe(before);
  });

  it("a blank DATABASE_URL counts as unset", async () => {
    process.env.DATABASE_URL = "   ";
    const store = getPlatformStore();
    await store.markProjectsInitialized("owner-4");
    const { rows } = await pool.query<{ initialized: number }>(
      "SELECT initialized FROM project_owner_state WHERE owner_id = 'owner-4'",
    );
    expect(rows).toHaveLength(0);
  });
});
