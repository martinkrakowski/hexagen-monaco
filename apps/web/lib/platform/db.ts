export type SqlValue = string | number | bigint | Buffer | null;

/**
 * Bind parameters. A statement may use either form, supplied as a single
 * argument:
 *  - positional `?` placeholders, bound by a positional array (`SqlValue[]`);
 *  - named `@name` placeholders, bound by a record whose keys are the bare names
 *    (no `@`, `$`, or `:` prefix). An implementation must accept both.
 *
 * No store should write `$1` (Posgres positional) or `:name` / `$name`
 * (SQLite named) directly: a Postgres seam translates both accepted forms to
 * `$1…$n`.
 */
export type SqlParams =
  | readonly SqlValue[]
  | Readonly<Record<string, SqlValue>>;

export interface RunResult {
  /** Rows changed by an INSERT, UPDATE or DELETE. */
  readonly changes: number;
}

/** What a store may do with the database, inside or outside a transaction. */
export interface PlatformDbSession {
  all<Row = unknown>(sql: string, params?: SqlParams): Promise<Row[]>;
  get<Row = unknown>(sql: string, params?: SqlParams): Promise<Row | undefined>;
  run(sql: string, params?: SqlParams): Promise<RunResult>;
}

/**
 * Composition pattern for the later lanes: a store method that must be callable
 * inside another store's transaction takes an optional last argument
 * `session?: PlatformDbSession` and uses `session ?? db`.
 */
export interface PlatformDb extends PlatformDbSession {
  /**
   * Runs `fn` in one transaction. Resolves with fn's value after COMMIT;
   * if fn throws or its promise rejects, ROLLBACK, then rethrow the same error.
   *
   * Guarantees:
   *  - All of a callback's statements commit, or none do.
   *  - On the SQLite implementation a callback's statements are not interleaved
   *    with another transaction's, because it uses a single connection. An
   *    implementation backed by a connection pool does NOT give that isolation by
   *    itself, so a store must not rely on "read then write" being safe inside
   *    `transaction` without stating so.
   *  - Nested `db.transaction` calls are rejected, and so is a plain
   *    `db.run/get/all` made inside a callback (use the `tx` session instead).
   *
   * A callback must only `await` the `tx` session and short local work. A
   * callback that awaits something that never resolves holds the seam's queue
   * open; no timeout is applied, so never do that.
   *
   * Work that touches the database must be started inside the callback, on `tx`.
   * A plain `db` call started before or outside the transaction and awaited
   * inside the callback is queued behind this transaction and never resolves:
   * a deadlock.
   *
   * On Postgres a transaction runs at SERIALIZABLE and the callback may be run
   * MORE THAN ONCE: when the server reports a serialization failure or a
   * deadlock, the transaction is rolled back and the callback is called again. A
   * callback must therefore touch nothing but `tx` and its own local variables.
   */
  transaction<T>(fn: (tx: PlatformDbSession) => Promise<T>): Promise<T>;
  /** Which SQL dialect the statements run on. */
  readonly dialect: "sqlite" | "postgres";
  /** True when `error` is a SQLite unique / primary-key constraint violation. */
  isUniqueViolation(error: unknown): boolean;
  /** True when `error` is a foreign-key constraint violation. */
  isForeignKeyViolation(error: unknown): boolean;
  close(): Promise<void>;
}
