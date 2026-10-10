// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";
import type { KeyMetadata } from "@hexagen/byok";
import { createTestPgDb } from "../../test-support/pg-test-db";
import { getByokStore, closeByokStore } from "../byok-store";

function fixture(over: Partial<KeyMetadata> = {}): KeyMetadata {
  return {
    keyId: "key-1",
    userId: "user-1",
    provider: "openai",
    keyVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
    revokedBy: null,
    ...over,
  };
}

describe("BYOK store selection by DATABASE_URL", () => {
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
    savedDbPath = process.env.BYOK_DB_PATH;
    delete process.env.DATABASE_URL;
    delete process.env.BYOK_DB_PATH;
  });

  afterEach(async () => {
    await closeByokStore();
    if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDbUrl;
    if (savedDbPath === undefined) delete process.env.BYOK_DB_PATH;
    else process.env.BYOK_DB_PATH = savedDbPath;
    await drop();
  });

  async function storeAndRead() {
    const store = getByokStore();
    expect((await store.metadata.store(fixture())).success).toBe(true);
    const byId = await store.metadata.findByKeyId("key-1");
    expect(byId.success && byId.value?.userId).toBe("user-1");
    return store;
  }

  it("with DATABASE_URL set, getByokStore writes to Postgres", async () => {
    process.env.DATABASE_URL = url;
    await storeAndRead();
    const r = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM byok_key_metadata",
    );
    expect(r.rows[0].n).toBe(1);
  });

  it("without DATABASE_URL, getByokStore works on SQLite as today", async () => {
    await storeAndRead();
    const r = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM byok_key_metadata",
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("a whitespace-only DATABASE_URL counts as unset (SQLite)", async () => {
    process.env.DATABASE_URL = "   ";
    await storeAndRead();
    const r = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM byok_key_metadata",
    );
    expect(r.rows[0].n).toBe(0);
  });
});
