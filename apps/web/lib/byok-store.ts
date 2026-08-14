import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ok, err } from "@hexagen/byok";
import type {
  Result,
  ByokError,
  ByokProvider,
  KeyMetadata,
  KeyMetadataStorePort,
  RevocationStorePort,
} from "@hexagen/byok";

/**
 * Durable BYOK metadata + revocation store (AUD-007).
 *
 * The in-memory adapters (`InMemoryKeyMetadataAdapter` /
 * `InMemoryRevocationAdapter`) lose all key metadata and — critically — every
 * revocation the moment the web container restarts or redeploys. A key a user
 * revoked would come back "live" after the next deploy. This backs both
 * out-ports with SQLite (better-sqlite3) on the same volume-mounted DB dir as
 * the free-tier quota store, so revocations survive restarts.
 *
 * Native `better-sqlite3` lives here in `apps/web/lib/`, alongside
 * `quota-store.ts`, and is reached only through server-side API routes (via
 * `byok-wire`) — so it never enters a client bundle. The `@hexagen/byok`
 * package itself stays free of native deps and remains client-importable.
 *
 * Single web container ⇒ single process: better-sqlite3 is synchronous, so each
 * write is atomic with no races. WAL + a busy timeout keep it safe even if a
 * second process ever opens the same file.
 */

export interface ByokStore {
  metadata: KeyMetadataStorePort;
  revocation: RevocationStorePort;
  close(): void;
}

/** Column shape of `byok_key_metadata` rows. */
interface MetadataRow {
  key_id: string;
  user_id: string;
  provider: string;
  key_version: number;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

function rowToMetadata(row: MetadataRow): KeyMetadata {
  return {
    keyId: row.key_id,
    userId: row.user_id,
    provider: row.provider as ByokProvider,
    keyVersion: row.key_version,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  };
}

/** Mirror of the in-memory adapters' catch-arm error. */
function metadataStoreError<T>(
  error: unknown,
  fallback: string,
): Result<T, ByokError> {
  return err({
    kind: "metadata_store_error",
    message: error instanceof Error ? error.message : fallback,
  } satisfies ByokError) as Result<T, ByokError>;
}

export function createByokStore(dbPath: string): ByokStore {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS byok_key_metadata (
      key_id      TEXT    PRIMARY KEY,
      user_id     TEXT    NOT NULL,
      provider    TEXT    NOT NULL,
      key_version INTEGER NOT NULL,
      created_at  TEXT    NOT NULL,
      revoked_at  TEXT,
      revoked_by  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_byok_meta_user_provider
      ON byok_key_metadata (user_id, provider);
    CREATE TABLE IF NOT EXISTS byok_revocations (
      user_id    TEXT NOT NULL,
      provider   TEXT NOT NULL,
      key_id     TEXT NOT NULL,
      revoked_at TEXT NOT NULL,
      revoked_by TEXT NOT NULL,
      PRIMARY KEY (user_id, provider)
    );
  `);

  // Upsert on key_id mirrors the in-memory `byKeyId.set(keyId, …)` overwrite.
  const upsertMetaStmt = db.prepare(`
    INSERT INTO byok_key_metadata
      (key_id, user_id, provider, key_version, created_at, revoked_at, revoked_by)
    VALUES
      (@key_id, @user_id, @provider, @key_version, @created_at, @revoked_at, @revoked_by)
    ON CONFLICT(key_id) DO UPDATE SET
      user_id     = excluded.user_id,
      provider    = excluded.provider,
      key_version = excluded.key_version,
      created_at  = excluded.created_at,
      revoked_at  = excluded.revoked_at,
      revoked_by  = excluded.revoked_by
  `);
  // Last-write-wins per (user, provider) mirrors the in-memory `byUserProvider`
  // map: newest row (highest rowid) is the current one.
  const findByUserProviderStmt = db.prepare(
    `SELECT * FROM byok_key_metadata WHERE user_id = ? AND provider = ?
       ORDER BY rowid DESC LIMIT 1`,
  );
  const findByKeyIdStmt = db.prepare(
    "SELECT * FROM byok_key_metadata WHERE key_id = ?",
  );
  const markRevokedStmt = db.prepare(
    "UPDATE byok_key_metadata SET revoked_at = ?, revoked_by = ? WHERE key_id = ?",
  );
  // hasKeys counts revoked rows too — matches the in-memory adapter, which
  // iterates every stored (user, provider) key without filtering revocation.
  const hasKeysStmt = db.prepare(
    "SELECT 1 FROM byok_key_metadata WHERE user_id = ? LIMIT 1",
  );

  const upsertRevocationStmt = db.prepare(`
    INSERT INTO byok_revocations (user_id, provider, key_id, revoked_at, revoked_by)
    VALUES (@user_id, @provider, @key_id, @revoked_at, @revoked_by)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      key_id     = excluded.key_id,
      revoked_at = excluded.revoked_at,
      revoked_by = excluded.revoked_by
  `);
  const isRevokedStmt = db.prepare(
    "SELECT 1 FROM byok_revocations WHERE user_id = ? AND provider = ? LIMIT 1",
  );

  const metadata: KeyMetadataStorePort = {
    async store(m) {
      try {
        upsertMetaStmt.run({
          key_id: m.keyId,
          user_id: m.userId,
          provider: m.provider,
          key_version: m.keyVersion,
          created_at: m.createdAt,
          revoked_at: m.revokedAt,
          revoked_by: m.revokedBy,
        });
        return ok(undefined) as Result<void, ByokError>;
      } catch (error) {
        return metadataStoreError(error, "Failed to store key metadata");
      }
    },
    async findByUserAndProvider(userId, provider) {
      try {
        const row = findByUserProviderStmt.get(userId, provider) as
          | MetadataRow
          | undefined;
        return ok(row ? rowToMetadata(row) : null) as Result<
          KeyMetadata | null,
          ByokError
        >;
      } catch (error) {
        return metadataStoreError(
          error,
          "Failed to find key metadata by user and provider",
        );
      }
    },
    async findByKeyId(keyId) {
      try {
        const row = findByKeyIdStmt.get(keyId) as MetadataRow | undefined;
        return ok(row ? rowToMetadata(row) : null) as Result<
          KeyMetadata | null,
          ByokError
        >;
      } catch (error) {
        return metadataStoreError(
          error,
          "Failed to find key metadata by key ID",
        );
      }
    },
    async markRevoked(keyId, revokedBy) {
      try {
        const existing = findByKeyIdStmt.get(keyId) as MetadataRow | undefined;
        if (!existing) {
          return err({
            kind: "key_not_found",
            message: `Key metadata not found for keyId: ${keyId}`,
            provider: "unknown",
          } satisfies ByokError);
        }
        markRevokedStmt.run(new Date().toISOString(), revokedBy, keyId);
        return ok(undefined) as Result<void, ByokError>;
      } catch (error) {
        return metadataStoreError(error, "Failed to mark key as revoked");
      }
    },
    async hasKeys(userId) {
      try {
        const found = hasKeysStmt.get(userId);
        return ok(found !== undefined) as Result<boolean, ByokError>;
      } catch (error) {
        return metadataStoreError(error, "Failed to check user keys");
      }
    },
  };

  const revocation: RevocationStorePort = {
    async revoke(entry) {
      try {
        upsertRevocationStmt.run({
          user_id: entry.userId,
          provider: entry.provider,
          key_id: entry.keyId,
          revoked_at: entry.revokedAt,
          revoked_by: entry.revokedBy,
        });
        return ok(undefined) as Result<void, ByokError>;
      } catch (error) {
        return metadataStoreError(error, "Failed to record revocation");
      }
    },
    async isRevoked(userId, provider) {
      try {
        const found = isRevokedStmt.get(userId, provider);
        return ok(found !== undefined) as Result<boolean, ByokError>;
      } catch (error) {
        return metadataStoreError(error, "Failed to check revocation status");
      }
    },
  };

  return {
    metadata,
    revocation,
    close() {
      db.close();
    },
  };
}

/** Where the durable DB lives in prod; in-memory elsewhere so dev/test leave no
 * file behind. Overridable via `BYOK_DB_PATH` (the prod volume mount, shared
 * with the quota DB dir). */
const DEFAULT_DB_PATH =
  process.env.NODE_ENV === "production" ? "/data/byok.db" : ":memory:";

let singleton: ByokStore | null = null;

/** Process-wide store bound to the configured path. `byok-wire` wires this into
 * the use cases; tests call `createByokStore(<path>)` directly for isolation. */
export function getByokStore(): ByokStore {
  if (!singleton) {
    singleton = createByokStore(process.env.BYOK_DB_PATH ?? DEFAULT_DB_PATH);
  }
  return singleton;
}

/** Close and drop the singleton so the next `getByokStore()` reopens from disk.
 * `clearByokCache()` calls this to simulate a process restart in tests. */
export function closeByokStore(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
