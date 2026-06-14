import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Free-tier daily quota store (PR-6).
 *
 * Backs the per-anonymous-session daily caps with SQLite (better-sqlite3) so
 * counts survive container restarts/redeploys — unlike the in-memory per-IP
 * limiter (`lib/rate-limiter.ts`), which stays as the burst/abuse backstop.
 *
 * Single web container ⇒ single process: better-sqlite3 is synchronous, so each
 * `consume` runs as an atomic transaction with no races. WAL + a busy timeout
 * keep it safe even if a second process ever opens the same file.
 */

export type QuotaKind = "generation" | "chat";

const KINDS: readonly QuotaKind[] = ["generation", "chat"];

/** Daily per-session limits — 10 generations, 100 chat messages (PR-6 spec). */
export const QUOTA_LIMITS: Record<QuotaKind, number> = {
  generation: 10,
  chat: 100,
};

export interface QuotaResult {
  /** For `consume`: whether this request was counted (within the cap). For
   * `peek`: whether the *next* request would be allowed. */
  allowed: boolean;
  /** Requests counted today for this kind (includes the current one when a
   * `consume` was allowed). */
  used: number;
  /** The daily cap for this kind. */
  limit: number;
  /** Requests left today (never negative). */
  remaining: number;
  /** Epoch ms when the window resets (the next UTC midnight). */
  resetAt: number;
}

export interface QuotaStore {
  /** Count one request of `kind` for `sessionId`; deny (without counting) once
   * the daily cap is reached. `now` is injectable for tests. */
  consume(sessionId: string, kind: QuotaKind, now?: number): QuotaResult;
  /** Current usage for one kind, without counting. */
  peek(sessionId: string, kind: QuotaKind, now?: number): QuotaResult;
  /** Usage across every kind — for the quota-status endpoint. */
  snapshot(sessionId: string, now?: number): Record<QuotaKind, QuotaResult>;
  close(): void;
}

/** `YYYY-MM-DD` in UTC — the daily bucket key. */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Epoch ms of the next UTC midnight strictly after `now`. */
function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function toResult(
  kind: QuotaKind,
  used: number,
  allowed: boolean,
  now: number,
): QuotaResult {
  const limit = QUOTA_LIMITS[kind];
  return {
    allowed,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: nextUtcMidnight(now),
  };
}

export function createQuotaStore(dbPath: string): QuotaStore {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS quota_usage (
      session_id TEXT    NOT NULL,
      day        TEXT    NOT NULL,
      kind       TEXT    NOT NULL,
      count      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, day, kind)
    )
  `);

  const selectStmt = db.prepare(
    "SELECT count FROM quota_usage WHERE session_id = ? AND day = ? AND kind = ?",
  );
  const incrementStmt = db.prepare(
    `INSERT INTO quota_usage (session_id, day, kind, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(session_id, day, kind) DO UPDATE SET count = count + 1`,
  );
  const pruneStmt = db.prepare("DELETE FROM quota_usage WHERE day < ?");

  // Drop stale buckets the first time we see a new day — bounds table growth
  // without a DELETE on every request.
  let lastPrunedDay = "";
  function pruneIfNewDay(day: string): void {
    if (day !== lastPrunedDay) {
      pruneStmt.run(day);
      lastPrunedDay = day;
    }
  }

  function currentCount(
    sessionId: string,
    day: string,
    kind: QuotaKind,
  ): number {
    const row = selectStmt.get(sessionId, day, kind) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  const consumeTxn = db.transaction(
    (sessionId: string, day: string, kind: QuotaKind) => {
      const current = currentCount(sessionId, day, kind);
      if (current >= QUOTA_LIMITS[kind]) {
        return { allowed: false, used: current };
      }
      incrementStmt.run(sessionId, day, kind);
      return { allowed: true, used: current + 1 };
    },
  );

  return {
    consume(sessionId, kind, now = Date.now()) {
      const day = utcDay(now);
      pruneIfNewDay(day);
      const { allowed, used } = consumeTxn(sessionId, day, kind);
      return toResult(kind, used, allowed, now);
    },
    peek(sessionId, kind, now = Date.now()) {
      const day = utcDay(now);
      const used = currentCount(sessionId, day, kind);
      return toResult(kind, used, used < QUOTA_LIMITS[kind], now);
    },
    snapshot(sessionId, now = Date.now()) {
      const day = utcDay(now);
      const out = {} as Record<QuotaKind, QuotaResult>;
      for (const kind of KINDS) {
        const used = currentCount(sessionId, day, kind);
        out[kind] = toResult(kind, used, used < QUOTA_LIMITS[kind], now);
      }
      return out;
    },
    close() {
      db.close();
    },
  };
}

/** Where the durable DB lives in prod; in-memory elsewhere so dev/test leave no
 * file behind. Overridable via `QUOTA_DB_PATH` (the prod volume mount). */
const DEFAULT_DB_PATH =
  process.env.NODE_ENV === "production" ? "/data/quota.db" : ":memory:";

let singleton: QuotaStore | null = null;

/** Process-wide store bound to the configured path. Routes use this; tests call
 * `createQuotaStore(":memory:")` directly for isolation. */
export function getQuotaStore(): QuotaStore {
  if (!singleton) {
    singleton = createQuotaStore(process.env.QUOTA_DB_PATH ?? DEFAULT_DB_PATH);
  }
  return singleton;
}
