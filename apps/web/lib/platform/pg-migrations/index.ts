import initial from "./0001_initial.sql?raw";
import revsAndDetail from "./0002_owner_document_revs_and_audit_detail.sql?raw";
import byok from "./0003_byok.sql?raw";

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
  {
    version: 2,
    name: "owner_document_revs_and_audit_detail",
    sql: revsAndDetail,
  },
  { version: 3, name: "byok", sql: byok },
];
