import initial from "./0001_initial.sql?raw";

export interface PgMigration {
  version: number;
  name: string;
  sql: string;
  /** Default true. With false the SQL and the bookkeeping row run outside a
   * transaction; the migration must then be idempotent AND must be exactly ONE
   * statement (Postgres runs a multi-statement query as one implicit
   * transaction, so a second statement would put it back inside one). A
   * transactional migration must not contain BEGIN or COMMIT. */
  transactional?: boolean;
}

export const PG_MIGRATIONS: readonly PgMigration[] = [
  { version: 1, name: "initial", sql: initial },
];
