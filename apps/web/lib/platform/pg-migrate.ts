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

// A leading BOM and CRLF line endings must not change a checksum: the SQL is
// the same text regardless of how the file was transferred.
export function checksumOf(sql: string): string {
  return createHash("sha256")
    .update(sql.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"))
    .digest("hex");
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

  // 1b. Validate migration SQL before touching the database.
  for (const migration of migrations) {
    if (migration.transactional === false) {
      // A non-transactional migration must be exactly ONE statement: Postgres
      // runs a multi-statement simple query inside an implicit transaction, so
      // a second statement would silently put it back inside one. Count the
      // semicolons that are followed by non-whitespace.
      const extraStmts = (migration.sql.match(/;\s*\S/g) || []).length;
      if (extraStmts > 0) {
        throw new Error(
          `migration ${migration.version} is non-transactional but has ${extraStmts + 1} statements; it must be exactly one`,
        );
      }
    } else {
      // A transactional migration must not manage its own transaction.
      if (/\b(BEGIN|COMMIT)\b\s*;/i.test(migration.sql)) {
        throw new Error(
          `migration ${migration.version} contains BEGIN or COMMIT; a transactional migration must not manage its own transaction`,
        );
      }
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

    // Refuse: the applied set must be exactly 1..k with no gap.
    for (let i = 0; i < res.rows.length; i++) {
      const expected = i + 1;
      if (res.rows[i].version !== expected) {
        throw new Error(
          `the applied set is not a contiguous prefix of 1..k: version ${expected} is missing (found ${res.rows[i].version} at position ${i})`,
        );
      }
    }

    // 6. Apply each known migration not yet applied, in order
    for (const migration of migrations) {
      const migrationChecksum = checksumOf(migration.sql);

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
