// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestPgDb } from "../../../test-support/pg-test-db";
import type { PlatformDb } from "../db";

describe("pg-db", () => {
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

  async function createHxFunctions() {
    await db.run(
      "CREATE OR REPLACE FUNCTION hx_ts(ms bigint) " +
        "RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ " +
        "SELECT timestamptz 'epoch' + ms * interval '1 millisecond' $$",
    );
    await db.run(
      "CREATE OR REPLACE FUNCTION hx_ms(ts timestamptz) " +
        "RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ " +
        "SELECT (extract(epoch from ts) * 1000)::bigint $$",
    );
    await db.run(
      "CREATE OR REPLACE FUNCTION hx_day(ts timestamptz) " +
        "RETURNS text LANGUAGE sql STABLE AS $$ " +
        "SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') $$",
    );
  }

  it("type shapes: timestamptz, boolean, jsonb, bigint, count(*)", async () => {
    await db.run(
      "CREATE TABLE shapes_t (ts timestamptz, flag boolean, data jsonb, big bigint)",
    );
    const now = new Date(1759900000000).toISOString();
    const jsonData = JSON.stringify({ hello: "world" });
    await db.run(
      "INSERT INTO shapes_t (ts, flag, data, big) VALUES (?, ?, ?, ?)",
      [now, 1, jsonData, 42],
    );
    const row = await db.get<{
      ts: string;
      flag: number;
      data: string;
      big: number;
    }>("SELECT ts, flag, data, big FROM shapes_t");
    expect(row?.ts).toBe(now);
    expect(row?.flag).toBe(1);
    expect(typeof row?.data).toBe("string");
    expect(JSON.parse(row?.data ?? "{}")).toEqual({ hello: "world" });
    expect(typeof row?.big).toBe("number");
    expect(row?.big).toBe(42);

    const countRow = await db.get<{ n: number }>(
      "SELECT count(*) AS n FROM shapes_t",
    );
    expect(typeof countRow?.n).toBe("number");
    expect(countRow?.n).toBe(1);
  });

  it("hx_ts/hx_ms round-trip and hx_day", async () => {
    await createHxFunctions();

    const now = Date.now();
    const ts = await db.get<{ ts: string }>("SELECT hx_ts(?) AS ts", [now]);
    const roundTripped = new Date(ts!.ts).getTime();
    expect(roundTripped).toBe(now);

    const ms = await db.get<{ ms: number }>("SELECT hx_ms(hx_ts(?)) AS ms", [
      now,
    ]);
    expect(ms?.ms).toBe(now);

    const zero = await db.get<{ ts: string; ms: number }>(
      "SELECT hx_ts(?) AS ts, hx_ms(hx_ts(?)) AS ms",
      [0, 0],
    );
    expect(zero?.ms).toBe(0);
    expect(new Date(zero!.ts).getTime()).toBe(0);

    const day = await db.get<{ d: string }>(
      "SELECT hx_day(hx_ts(?)) AS d",
      [1759900000000],
    );
    expect(day?.d).toBe("2025-10-08");

    // a timestamptz written from new Date().toISOString() reads back identical
    const written = new Date(now).toISOString();
    const read = await db.get<{ ts: string }>("SELECT ?::timestamptz AS ts", [
      written,
    ]);
    expect(read?.ts).toBe(written);
  });

  it("retry: a 40001 on first call retries and commits once", async () => {
    await db.run("CREATE TABLE retry_t (id integer PRIMARY KEY, val integer)");
    let attempt = 0;
    await db.transaction(async (tx) => {
      attempt++;
      if (attempt === 1) {
        const err = new Error("serialization failure") as Error & {
          code: string;
        };
        err.code = "40001";
        throw err;
      }
      await tx.run("INSERT INTO retry_t (id, val) VALUES (?, ?)", [1, 10]);
    });
    expect(attempt).toBe(2);
    const row = await db.get<{ val: number }>(
      "SELECT val FROM retry_t WHERE id = 1",
    );
    expect(row?.val).toBe(10);
  });

  it("retry: a 40001 every time rejects after 5 attempts with SerializationRetryExhausted", async () => {
    let attempt = 0;
    await expect(
      db.transaction(async () => {
        attempt++;
        const err = new Error("always fails") as Error & { code: string };
        err.code = "40001";
        throw err;
      }),
    ).rejects.toMatchObject({
      name: "SerializationRetryExhausted",
    });
    expect(attempt).toBe(5);
  });

  it("retry: an error with another code is not retried", async () => {
    let attempt = 0;
    const err = new Error("syntax error") as Error & { code: string };
    err.code = "42601";
    await expect(
      db.transaction(async () => {
        attempt++;
        throw err;
      }),
    ).rejects.toBe(err);
    expect(attempt).toBe(1);
  });

  it("real serialization failure: two concurrent transactions, exactly one row", async () => {
    await db.run("CREATE TABLE ser_t (val integer)");

    const results = await Promise.allSettled([
      db.transaction(async (tx) => {
        const count = await tx.get<{ n: number }>(
          "SELECT count(*) AS n FROM ser_t",
        );
        if ((count?.n ?? 0) === 0) {
          await tx.run("INSERT INTO ser_t (val) VALUES (?)", [10]);
        }
        return "done";
      }),
      db.transaction(async (tx) => {
        const count = await tx.get<{ n: number }>(
          "SELECT count(*) AS n FROM ser_t",
        );
        if ((count?.n ?? 0) === 0) {
          await tx.run("INSERT INTO ser_t (val) VALUES (?)", [20]);
        }
        return "done";
      }),
    ]);

    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }

    const rows = await db.all<{ val: number }>("SELECT * FROM ser_t");
    expect(rows).toHaveLength(1);
  });

  it("a ? or @word inside a quoted literal or -- comment is not translated", async () => {
    // ? inside a single-quoted string is not translated
    const r1 = await db.get<{ lit: string }>(
      "SELECT ? AS a, 'literal ? here' AS lit",
      [42],
    );
    expect(r1?.lit).toBe("literal ? here");

    // @word inside a single-quoted string is not translated
    const r2 = await db.get<{ lit: string }>(
      "SELECT ? AS a, '@word' AS lit",
      [42],
    );
    expect(r2?.lit).toBe("@word");

    // ? inside a -- comment is not translated
    const r3 = await db.get<{ n: number }>(
      "SELECT ? AS a, 1 AS n -- comment with ? mark",
      [42],
    );
    expect(r3?.n).toBe(1);

    // @word inside a -- comment is not translated
    const r4 = await db.get<{ n: number }>(
      "SELECT ? AS a, 1 AS n -- comment with @word",
      [42],
    );
    expect(r4?.n).toBe(1);
  });
});
