import initial from "./0001_initial.sql?raw";

export interface PgMigration {
  version: number;
  name: string;
  sql: string;
  /** Default true. False for SQL that cannot run inside a transaction; it must then be idempotent. */
  transactional?: boolean;
}

export const PG_MIGRATIONS: readonly PgMigration[] = [
  { version: 1, name: "initial", sql: initial },
];
