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
 * Queueing rule (one connection, one transaction at a time): a promise chain
 * (`tail`) serialises every queued unit against the single connection.
 *   - `transaction` and plain `db.all/get/run` all enqueue on `tail`, so a plain
 *     call never lands inside an in-flight transaction and two transactions
 *     never interleave.
 *   - Calls made on the `tx` session bypass the queue and run immediately
 *     inside the open transaction.
 *   - A rejected queued unit is swallowed when advancing `tail`, so a later
 *     failure can never wedge the queue.
 *
 * Nested `db.transaction` calls (one invoked from inside another's callback)
 * are rejected using an async-local slot: the single connection can only hold
 * one open `BEGIN`, and savepoints are deliberately not implemented.
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
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const nestedGuard = new AsyncLocalStorage<boolean>();

  return {
    run: (sql, params) => enqueue(() => runSync(sql, params)),
    get: (sql, params) => enqueue(() => getSync(sql, params)),
    all: (sql, params) => enqueue(() => allSync(sql, params)),
    transaction: <T>(fn: (tx: PlatformDbSession) => Promise<T>): Promise<T> => {
      if (nestedGuard.getStore()) {
        return Promise.reject(
          new Error(
            "Nested transactions are not supported: start one transaction and compose statements within it",
          ),
        );
      }
      return enqueue(async () => {
        let finished = false;
        const finishedErr = new Error("transaction is finished");
        const tx: PlatformDbSession = {
          all: (sql, params) =>
            finished ? Promise.reject(finishedErr) : allSync(sql, params),
          get: (sql, params) =>
            finished ? Promise.reject(finishedErr) : getSync(sql, params),
          run: (sql, params) =>
            finished ? Promise.reject(finishedErr) : runSync(sql, params),
        };
        handle.exec("BEGIN IMMEDIATE");
        try {
          const result = await nestedGuard.run(true, () => fn(tx));
          handle.exec("COMMIT");
          finished = true;
          return result;
        } catch (e) {
          try {
            handle.exec("ROLLBACK");
          } catch {
            /* still rethrow the original error */
          }
          finished = true;
          throw e;
        }
      });
    },
    close: () =>
      tail.then(() => {
        handle.close();
      }),
  };
}
