import { Pool } from "pg";
import type { PlatformDb } from "../lib/platform/db";
import { createPgPool, createPgPlatformDb } from "../lib/platform/pg-db";

let counter = 0;

/** A fresh, empty database cloned from template0; `drop()` ends the pool and drops it. */
export async function createTestPgDb(): Promise<{
  pool: Pool;
  db: PlatformDb;
  url: string;
  drop(): Promise<void>;
}> {
  const homeUrl = process.env.PLATFORM_TEST_PG_URL;
  if (!homeUrl) {
    throw new Error(
      "PLATFORM_TEST_PG_URL is not set: set it to a postgres:// user-level connection " +
        "to the home database (e.g. postgres://hx_test@10.60.0.1:5434/hx_home) or " +
        "start embedded-postgres via the global setup.",
    );
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 12);
  const suffix = [...Array(4)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
  const name = `hx_${stamp}${suffix}_${process.pid}_${counter++}`;

  const homePool = new Pool({ connectionString: homeUrl });
  try {
    await homePool.query(
      `CREATE DATABASE ${name} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'`,
    );
  } finally {
    await homePool.end();
  }

  const dbUrl = homeUrl.replace(/\/[^/]+$/, `/${name}`);
  const pool = createPgPool(dbUrl);
  const db = createPgPlatformDb(pool);

  return {
    pool,
    db,
    url: dbUrl,
    drop: async () => {
      if (!pool.ending) await pool.end();
      const dropPool = new Pool({ connectionString: homeUrl });
      try {
        await dropPool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await dropPool.end();
      }
    },
  };
}
