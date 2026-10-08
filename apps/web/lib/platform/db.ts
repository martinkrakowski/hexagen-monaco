export type SqlValue = string | number | bigint | Buffer | null;
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

export interface PlatformDb extends PlatformDbSession {
  /**
   * Runs `fn` in one transaction. Resolves with fn's value after COMMIT;
   * if fn throws or its promise rejects, ROLLBACK, then rethrow the same error.
   */
  transaction<T>(fn: (tx: PlatformDbSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
