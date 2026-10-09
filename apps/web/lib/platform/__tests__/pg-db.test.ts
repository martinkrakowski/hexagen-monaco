// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";
import { createTestPgDb } from "../../../test-support/pg-test-db";
import type { PlatformDb } from "../db";

describe("pg-db", () => {
  let db: PlatformDb;
  let pool: Pool;
  let drop: () => Promise<void>;

  beforeEach(async () => {
    const result = await createTestPgDb();
    pool = result.pool;
    db = result.db;
    drop = result.drop;
  });

  afterEach(async () => {
    await db.close();
    await drop();
  });

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

    let callCount = 0;
    let readsDone = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const p1 = db.transaction(async (tx) => {
      callCount++;
      const count = await tx.get<{ n: number }>(
        "SELECT count(*) AS n FROM ser_t",
      );
      readsDone++;
      if (readsDone === 2) releaseBarrier();
      await barrier;
      if ((count?.n ?? 0) === 0) {
        await tx.run("INSERT INTO ser_t (val) VALUES (?)", [10]);
      }
      return "done";
    });

    const p2 = db.transaction(async (tx) => {
      callCount++;
      const count = await tx.get<{ n: number }>(
        "SELECT count(*) AS n FROM ser_t",
      );
      readsDone++;
      if (readsDone === 2) releaseBarrier();
      await barrier;
      if ((count?.n ?? 0) === 0) {
        await tx.run("INSERT INTO ser_t (val) VALUES (?)", [20]);
      }
      return "done";
    });

    const results = await Promise.allSettled([p1, p2]);
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }
    // At least one retry happened (2 first attempts + ≥1 retry = ≥3).
    expect(callCount).toBeGreaterThanOrEqual(3);

    const rows = await db.all<{ val: number }>("SELECT * FROM ser_t");
    expect(rows).toHaveLength(1);
  });

  it("a ? or @word inside a -- comment or double-quoted identifier is not translated", async () => {
    // @missing in a comment must not be translated — if it were, the missing
    // key would throw. The only real placeholder is @a.
    const r1 = await db.get<{ a: string }>("SELECT @a AS a -- @missing\n", {
      a: 42,
    });
    expect(Number(r1?.a)).toBe(42);

    // ? in a comment must not be translated. If it were, Postgres would see
    // two placeholders ($1, $2) but receive one value and reject.
    const r2 = await db.get<{ a: string }>(
      "SELECT ? AS a -- is this ? one\n",
      [42],
    );
    expect(Number(r2?.a)).toBe(42);

    // ? and @x inside a double-quoted identifier are not translated.
    const r3 = await db.get<Record<string, number>>('SELECT 1 AS "a?b@x"');
    expect(r3?.["a?b@x"]).toBe(1);
  });

  it("survives a dropped session: error listener + destroy on release", async () => {
    let pid: number | undefined;
    const txPromise = db.transaction(async (tx) => {
      const r = await tx.get<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      pid = r!.pid;
      // From a second connection, terminate the transaction's backend.
      const killer = await pool.connect();
      try {
        await killer.query("SELECT pg_terminate_backend($1)", [pid]);
      } finally {
        killer.release();
      }
      // Give the server a moment to close the connection.
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The connection is dead — this rejects.
      await tx.get("SELECT 1");
    });

    await expect(txPromise).rejects.toBeDefined();

    // The process is still alive: the pool can still serve queries.
    const row = await db.get<{ one: number }>("SELECT 1 AS one");
    expect(row?.one).toBe(1);
  });
});
