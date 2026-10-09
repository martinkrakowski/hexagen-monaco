import { Pool } from "pg";
import { createHash } from "node:crypto";
import type { PgMigration } from "./pg-migrations/index";
import { PG_MIGRATIONS } from "./pg-migrations/index";

const ADVISORY_LOCK_KEY = 7302026100801;

const SCHEMA_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version   integer PRIMARY KEY,
  name      text NOT NULL,
  checksum  text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)
`;

function sha256(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export async function runPgMigrations(
  pool: Pool,
  migrations: readonly PgMigration[] = PG_MIGRATIONS,
): Promise<{ applied: number[] }> {
  // 1. Validate migration versions are sequential: 1, 2, 3, ...
  for (let i = 0; i < migrations.length; i++) {
    const expected = i + 1;
    if (migrations[i].version !== expected) {
      throw new Error(
        `Migration version ${migrations[i].version} at index ${i} breaks the sequence: versions must be 1, 2, 3, … with no gap or repeat`,
      );
    }
  }

  const client = await pool.connect();
  const applied: number[] = [];

  try {
    // 3. Acquire advisory lock (blocks until acquired)
    await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`);

    // 4. Ensure schema_migrations table exists
    await client.query(SCHEMA_MIGRATIONS_TABLE);

    // 5. Read existing applied migrations and their checksums
    const res = await client.query<{
      version: number;
      checksum: string;
    }>("SELECT version, checksum FROM schema_migrations ORDER BY version");

    const maxKnownVersion = migrations[migrations.length - 1]?.version ?? 0;
    const appliedChecksums = new Map(
      res.rows.map((r) => [r.version, r.checksum]),
    );

    // Refuse: a database version higher than any known migration
    for (const row of res.rows) {
      if (row.version > maxKnownVersion) {
        throw new Error(
          `this build is older than the database: version ${row.version} exists in the database but is not in the migration list`,
        );
      }
    }

    // 6. Apply each known migration not yet applied, in order
    for (const migration of migrations) {
      const migrationChecksum = sha256(migration.sql);

      if (appliedChecksums.has(migration.version)) {
        // Checksum mismatch check
        const dbChecksum = appliedChecksums.get(migration.version);
        if (dbChecksum !== migrationChecksum) {
          throw new Error(
            `Migration checksum mismatch for version ${migration.version}: database has ${dbChecksum} but the build has ${migrationChecksum}`,
          );
        }
        continue; // Already applied, skip
      }

      if (migration.transactional !== false) {
        try {
          await client.query("BEGIN");
          // The SQL of one migration contains many statements: send it with
          // client.query(sql) as one simple query (no parameters).
          await client.query(migration.sql);
          await client.query(
            "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
            [migration.version, migration.name, migrationChecksum],
          );
          await client.query("COMMIT");
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore rollback errors
          }
          throw err;
        }
      } else {
        // Non-transactional: run the SQL, then the INSERT, each on its own.
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [migration.version, migration.name, migrationChecksum],
        );
      }
      applied.push(migration.version);
    }

    return { applied };
  } finally {
    // 7. Release the lock and the client, exactly once. If the unlock itself
    // fails the connection is in doubt: it is destroyed, not returned to the
    // pool, and the server drops a session-level lock with its session.
    let unlockError: unknown;
    try {
      await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
    } catch (error) {
      unlockError = error;
    }
    client.release(unlockError ? true : undefined);
  }
}
