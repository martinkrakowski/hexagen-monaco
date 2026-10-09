// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openByokDb } from "../../byok-store";
import { createTestPgDb } from "../../../test-support/pg-test-db";
import type { PlatformDb } from "../db";

const sqliteHandle = openByokDb(":memory:");
const BYOK_TABLES = ["byok_key_metadata", "byok_revocations"];

type SqliteCol = {
  name: string;
  type: string;
  notnull: number;
  pk: number;
};
function sqliteColumns(table: string): SqliteCol[] {
  return sqliteHandle.pragma(`table_info(${table})`) as SqliteCol[];
}

const timestamptzCols = new Set(["created_at", "revoked_at"]);

describe("pg-byok-schema", () => {
  let db: PlatformDb;
  let drop: () => Promise<void>;

  beforeEach(async () => {
    const result = await createTestPgDb();
    db = result.db;
    drop = result.drop;
  });

  afterEach(async () => {
    await db.close();
    await drop();
  });

  it("BYOK columns match SQLite in name, nullability and type on Postgres", async () => {
    let totalCols = 0;
    for (const table of BYOK_TABLES) {
      const cols = sqliteColumns(table);
      expect(cols.length).toBeGreaterThan(0);
      totalCols += cols.length;
      for (const col of cols) {
        const fullCol = `${table}.${col.name}`;
        const row = await db.get<{
          column_name: string;
          is_nullable: string;
          data_type: string;
        }>(
          "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
          [table, col.name],
        );
        expect(row, `Postgres is missing ${fullCol}`).toBeDefined();
        const sqliteNotNull = col.notnull === 1 || col.pk > 0;
        expect(row!.is_nullable, `${fullCol} nullability mismatch`).toBe(
          sqliteNotNull ? "NO" : "YES",
        );
        const sqliteType = col.type.toUpperCase();
        if (timestamptzCols.has(col.name)) {
          expect(row!.data_type, `${fullCol} should be timestamptz`).toBe(
            "timestamp with time zone",
          );
        } else if (col.name === "key_version") {
          expect(row!.data_type, `${fullCol} should be integer`).toBe(
            "integer",
          );
        } else if (col.name === "write_seq") {
          expect(row!.data_type, `${fullCol} should be bigint`).toBe("bigint");
        } else if (sqliteType === "TEXT") {
          expect(row!.data_type, `${fullCol} should be text`).toBe("text");
        }
      }
    }
    expect(totalCols).toBeGreaterThan(0);
  });

  it("primary keys match between SQLite and Postgres", async () => {
    const sqlitePks: Record<string, string[]> = {};
    for (const table of BYOK_TABLES) {
      sqlitePks[table] = sqliteColumns(table)
        .filter((c) => c.pk > 0)
        .map((c) => c.name)
        .sort();
    }

    for (const table of BYOK_TABLES) {
      const pkCols = await db.all<{ column_name: string }>(
        "SELECT a.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage a ON a.constraint_name = tc.constraint_name AND a.table_name = tc.table_name WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY' ORDER BY a.ordinal_position",
        [table],
      );
      expect(pkCols.map((c) => c.column_name).sort()).toEqual(sqlitePks[table]);
    }
  });

  it("the write-order index and sequence exist and nextval increases", async () => {
    const indexes = await db.all<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_byok_meta_user_provider'",
    );
    expect(indexes).toHaveLength(1);

    const seqRes = await db.get<{ last_value: string }>(
      "SELECT last_value FROM byok_write_seq",
    );
    expect(seqRes).toBeDefined();

    const a = (await db.get<{ nextval: string }>(
      "SELECT nextval('byok_write_seq') AS nextval",
    )) as { nextval: string };
    const b = (await db.get<{ nextval: string }>(
      "SELECT nextval('byok_write_seq') AS nextval",
    )) as { nextval: string };
    expect(Number(a.nextval)).toBeLessThan(Number(b.nextval));
  });
});
