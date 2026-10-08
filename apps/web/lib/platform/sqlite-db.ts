import type Database from "better-sqlite3";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PlatformDb, PlatformDbSession, RunResult, SqlParams } from "./db";

type PreparedStmt = {
  run(bind?: SqlParams): Database.RunResult;
  get(bind?: SqlParams): unknown;
  all(bind?: SqlParams): unknown[];
};

/**
 * SQLite-backed `PlatformDb` over a single `better-sqlite3` handle.
 *
 * Transactions are managed manually with `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`
 * because better-sqlite3's own `handle.transaction(fn)` rejects an async
 * callback with `TypeError: Transaction function cannot return a promise`.
 *
 * Queueing (one connection, one transaction at a time):
 *   - A `transaction` call increments `txCount` and enqueues its
 *     BEGIN/COMMIT/ROLLBACK unit on a promise chain (`tail`) so two
 *     transactions never interleave.
 *   - A plain `db.all/get/run` whose `txCount` is 0 runs the single driver call
 *     at once (it is atomic on its own); when `txCount > 0` it enqueues, so it
 *     never lands inside an in-flight transaction.
 *   - Calls made on the `tx` session bypass the chain and run inside the open
 *     transaction.
 *   - A rejected queued unit is swallowed when advancing `tail`, so a later
 *     failure can never wedge the queue.
 *
 * Guards:
 *   - A plain `db.all/get/run` issued from inside a transaction callback
 *     (detected via async-local slot) is rejected outright — routing it into
 *     the open transaction would deadlock.
 *   - `db.transaction` from inside a callback is rejected (nested); savepoints
 *     are deliberately not implemented.
 *   - Before BEGIN, if `handle.inTransaction` is already true (another store
 *     opened a raw transaction on the shared handle), the call is rejected and
 *     no BEGIN is issued, so a later COMMIT/ROLLBACK cannot silently undo it.
 */
export function createSqlitePlatformDb(handle: Database.Database): PlatformDb {
  const cache = new Map<string, PreparedStmt>();
  const prepare = (sql: string): PreparedStmt => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = handle.prepare(sql) as unknown as PreparedStmt;
      cache.set(sql, stmt);
    }
    return stmt;
  };

  const runSync = async (
    sql: string,
    params?: SqlParams,
  ): Promise<RunResult> => {
    const stmt = prepare(sql);
    const info = params === undefined ? stmt.run() : stmt.run(params);
    return { changes: info.changes };
  };
  const getSync = async <Row = unknown>(
    sql: string,
    params?: SqlParams,
  ): Promise<Row | undefined> => {
    const stmt = prepare(sql);
    return (params === undefined ? stmt.get() : stmt.get(params)) as
      | Row
      | undefined;
  };
  const allSync = async <Row = unknown>(
    sql: string,
    params?: SqlParams,
  ): Promise<Row[]> => {
    const stmt = prepare(sql);
    return (params === undefined ? stmt.all() : stmt.all(params)) as Row[];
  };

  // Promise chain serialising transactions and plain `db` calls. See header.
  let tail: Promise<void> = Promise.resolve();
  let closed = false;
  // Transactions currently running or queued; a plain call with txCount === 0
  // runs at once, otherwise it enqueues so it never lands inside an in-flight tx.
  let txCount = 0;
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  type TxToken = { active: boolean };
  const nestedGuard = new AsyncLocalStorage<TxToken>();
  const plainInTxError = () =>
    new Error(
      "plain db call inside a transaction: use the tx session passed to the callback",
    );
  // A plain call runs at once when no transaction is running or queued; if one
  // is, it enqueues so it never lands inside an in-flight transaction. Inside a
  // callback's async-local scope a plain call is always rejected (item 1).
  const immediateOrEnqueue = <T>(work: () => Promise<T>): Promise<T> => {
    if (nestedGuard.getStore()?.active) return Promise.reject(plainInTxError());
    if (txCount > 0) return enqueue(work);
    return work();
  };

  return {
    run: (sql, params) => immediateOrEnqueue(() => runSync(sql, params)),
    get: (sql, params) => immediateOrEnqueue(() => getSync(sql, params)),
    all: (sql, params) => immediateOrEnqueue(() => allSync(sql, params)),
    transaction: <T>(fn: (tx: PlatformDbSession) => Promise<T>): Promise<T> => {
      if (nestedGuard.getStore()?.active) {
        return Promise.reject(
          new Error(
            "Nested transactions are not supported: start one transaction and compose statements within it",
          ),
        );
      }
      txCount++;
      return enqueue(async () => {
        let finished = false;
        let begun = false;
        const finishedErr = new Error("transaction is finished");
        const tx: PlatformDbSession = {
          all: (sql, params) =>
            finished ? Promise.reject(finishedErr) : allSync(sql, params),
          get: (sql, params) =>
            finished ? Promise.reject(finishedErr) : getSync(sql, params),
          run: (sql, params) =>
            finished ? Promise.reject(finishedErr) : runSync(sql, params),
        };
        const token: TxToken = { active: true };
        try {
          if (handle.inTransaction) {
            throw new Error("a transaction is already open on this connection");
          }
          handle.exec("BEGIN IMMEDIATE");
          begun = true;
          const result = await nestedGuard.run(token, () => fn(tx));
          handle.exec("COMMIT");
          finished = true;
          return result;
        } catch (e) {
          if (begun) {
            try {
              handle.exec("ROLLBACK");
            } catch {
              /* still rethrow the original error */
            }
          }
          finished = true;
          throw e;
        } finally {
          token.active = false;
          txCount--;
        }
      });
    },
    close: () =>
      tail.then(() => {
        if (closed) return;
        closed = true;
        handle.close();
      }),
    isUniqueViolation: (error: unknown): boolean => {
      if (error === null || typeof error !== "object") return false;
      const code = (error as { code?: unknown }).code;
      return (
        code === "SQLITE_CONSTRAINT_UNIQUE" ||
        code === "SQLITE_CONSTRAINT_PRIMARYKEY"
      );
    },
  };
}
