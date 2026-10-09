import { Pool } from "pg";
import { inject } from "vitest";
import type { PlatformDb } from "../lib/platform/db";
import { createPgPool, createPgPlatformDb } from "../lib/platform/pg-db";

let counter = 0;

/** A fresh database; cloned from the migrated template by default, or empty
 * when `{ empty: true }` is passed. `drop()` ends the pool and drops it. */
export async function createTestPgDb(opts?: { empty?: boolean; max?: number }): Promise<{
  pool: Pool;
  db: PlatformDb;
  url: string;
  drop(): Promise<void>;
}> {
  const homeUrl = inject("pgHomeUrl");
  const run = inject("pgRun");
  const template = inject("pgTemplate");

  if (!homeUrl) {
    throw new Error(
      "no Postgres for tests: the embedded server could not start; set PLATFORM_TEST_PG_URL",
    );
  }

  const suffix = [...Array(4)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
  const name = `hx_${run}_${process.pid}_${counter++}_${suffix}`;

  const homePool = new Pool({ connectionString: homeUrl });
  try {
    if (opts?.empty) {
      await homePool.query(
        `CREATE DATABASE ${name} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C' ENCODING 'UTF8'`,
      );
    } else {
      await homePool.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
    }
  } finally {
    await homePool.end();
  }

  const dbUrl = homeUrl.replace(/\/[^/]+$/, `/${name}`);
   const pool = createPgPool(dbUrl, { max: opts?.max ?? 2 });
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
