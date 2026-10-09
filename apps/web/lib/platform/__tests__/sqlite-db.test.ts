import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import type { PlatformDb } from "../db";

describe("sqlite-db", () => {
  let db: PlatformDb;
  let handle: Database.Database;

  beforeEach(() => {
    handle = openPlatformDb(":memory:");
    handle.exec(
      "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, val INTEGER)",
    );
    handle.exec(
      "CREATE TABLE child (id INTEGER PRIMARY KEY, tid INTEGER NOT NULL, FOREIGN KEY (tid) REFERENCES test(id))",
    );
    db = createSqlitePlatformDb(handle);
  });

  it("4: a statement issued on plain db while a transaction is open is not part of it", async () => {
    let reachedWait = () => {};
    const iamWaiting = new Promise<void>((resolve) => {
      reachedWait = resolve;
    });
    let releaseGate = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const txPromise = db.transaction(async (tx) => {
      await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        1,
        "a",
        10,
      ]);
      reachedWait(); // signal: row A inserted, about to wait on the open transaction
      await gate;
      throw new Error("rollback me");
    });

    // Wait until the callback is actually waiting (transaction is open), then
    // issue a plain call without awaiting it yet.
    await iamWaiting;
    const plainRun = db.run(
      "INSERT INTO test (id, name, val) VALUES (?, ?, ?)",
      [2, "b", 20],
    );
    releaseGate();

    await expect(txPromise).rejects.toThrow("rollback me");
    await plainRun; // row B must have run only after the transaction ended

    const rows = await db.all<{ id: number }>("SELECT * FROM test ORDER BY id");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(2);
  });

  it("4b: a plain call with no transaction open runs immediately (synchronously)", () => {
    void db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
      1,
      "a",
      10,
    ]);
    const count = handle.prepare("SELECT COUNT(*) AS n FROM test").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it("5: two transactions started together run one after the other, never interleaved", async () => {
    const order: string[] = [];
    let release1: () => void = () => {};
    const hold1 = new Promise<void>((resolve) => {
      release1 = resolve;
    });

    const p1 = db.transaction(async (tx) => {
      order.push("begin 1");
      await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        1,
        "a",
        10,
      ]);
      await hold1; // yield in the middle
      order.push("end 1");
    });

    const p2 = db.transaction(async (tx) => {
      order.push("begin 2");
      await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        2,
        "b",
        20,
      ]);
      order.push("end 2");
    });

    release1();
    await Promise.all([p1, p2]);

    expect(order).toEqual(["begin 1", "end 1", "begin 2", "end 2"]);
    const rows = await db.all<{ id: number }>(
      "SELECT id FROM test ORDER BY id",
    );
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  it("3b: db.transaction rejects when a raw transaction is already open on the handle", async () => {
    handle.exec("BEGIN");
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
          1,
          "a",
          10,
        ]);
      }),
    ).rejects.toThrow("a transaction is already open on this connection");
    handle.exec("ROLLBACK");
    // the queue still works after the tripwire:
    await db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
      2,
      "b",
      20,
    ]);
    const rows = await db.all<{ id: number }>("SELECT * FROM test");
    expect(rows).toHaveLength(1);
  });

  it("8: the same SQL text run twice prepares the statement once", async () => {
    const spy = vi.spyOn(handle, "prepare");
    const sql = "INSERT INTO test (id, name, val) VALUES (?, ?, ?)";

    await db.run(sql, [1, "a", 10]);
    await db.run(sql, [2, "b", 20]);

    const preparesForSql = spy.mock.calls.filter((c) => c[0] === sql);
    expect(preparesForSql).toHaveLength(1);
    spy.mockRestore();
  });

  it("a plain call made in the same tick as a transaction waits for it", async () => {
    const t = db.transaction(async (tx) => {
      await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        1,
        "a",
        10,
      ]);
    });
    const q = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM test");
    await t;
    const result = await q;
    expect(result?.n).toBe(1);
  });

  it("after a transaction commits, a plain call runs at once", async () => {
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        1,
        "a",
        10,
      ]);
    });
    const runPromise = db.run(
      "INSERT INTO test (id, name, val) VALUES (?, ?, ?)",
      [2, "b", 20],
    );
    const count = handle.prepare("SELECT COUNT(*) AS n FROM test").get() as {
      n: number;
    };
    expect(count.n).toBe(2);
    await runPromise;
  });

  it("after a transaction rolls back, a plain call runs at once", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
          1,
          "a",
          10,
        ]);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const runPromise = db.run(
      "INSERT INTO test (id, name, val) VALUES (?, ?, ?)",
      [2, "b", 20],
    );
    const count = handle.prepare("SELECT COUNT(*) AS n FROM test").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
    await runPromise;
  });

  it("the statement cache is bounded: an evicted statement is prepared again, a cached one is not", async () => {
    const prepare = vi.spyOn(handle, "prepare");
    const preparesOf = (sql: string) =>
      prepare.mock.calls.filter(([text]) => text === sql).length;
    const first = "SELECT 0 AS n";
    expect((await db.get<{ n: number }>(first))?.n).toBe(0);
    expect((await db.get<{ n: number }>(first))?.n).toBe(0);
    expect(preparesOf(first), "a cached statement is prepared once").toBe(1);
    for (let i = 1; i <= 400; i++) {
      const row = await db.get<{ n: number }>(`SELECT ${i} AS n`);
      expect(row?.n).toBe(i);
    }
    // 400 distinct statements later the first is long evicted (the limit is
    // 256), so running it again prepares it again. A cache with no limit
    // would still hold it and this count would stay at 1.
    expect((await db.get<{ n: number }>(first))?.n).toBe(0);
    expect(preparesOf(first), "an evicted statement is prepared again").toBe(2);
    // The most recent statement is still cached.
    expect((await db.get<{ n: number }>("SELECT 400 AS n"))?.n).toBe(400);
    expect(preparesOf("SELECT 400 AS n")).toBe(1);
    prepare.mockRestore();
  });

  it("hx_ts/hx_ms/hx_day round-trip and day extraction", async () => {
    const row = await db.get<{ a: number; b: number; c: string }>(
      "SELECT hx_ts(5) AS a, hx_ms(7) AS b, hx_day(0) AS c",
    );
    expect(row).toEqual({ a: 5, b: 7, c: "1970-01-01" });

    const day = await db.get<{ d: string }>(
      "SELECT hx_day(?) AS d",
      [1759900000000],
    );
    expect(day?.d).toBe("2025-10-08");

    const rounded = await db.get<{ r: number }>(
      "SELECT hx_ms(hx_ts(?)) AS r",
      [1759900000000],
    );
    expect(rounded?.r).toBe(1759900000000);

    const nullDay = await db.get<{ d: string | null }>(
      "SELECT hx_day(NULL) AS d",
    );
    expect(nullDay?.d).toBeNull();
  });

  it("isForeignKeyViolation recognises an FK violation and not a unique one", async () => {
    await db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
      1,
      "a",
      10,
    ]);
    let fkErr: unknown = undefined;
    try {
      await db.run("INSERT INTO child (id, tid) VALUES (?, ?)", [1, 999]);
    } catch (e) {
      fkErr = e;
    }
    expect(db.isForeignKeyViolation(fkErr)).toBe(true);
    // isUniqueViolation does NOT recognise an FK violation
    expect(db.isUniqueViolation(fkErr)).toBe(false);

    let ukErr: unknown = undefined;
    try {
      await db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        1,
        "b",
        20,
      ]);
    } catch (e) {
      ukErr = e;
    }
    // isUniqueViolation recognises a unique violation
    expect(db.isUniqueViolation(ukErr)).toBe(true);
    // isForeignKeyViolation does NOT recognise a unique violation
    expect(db.isForeignKeyViolation(ukErr)).toBe(false);

    // neither recognises a plain error
    const plain = new Error("not a constraint");
    expect(db.isForeignKeyViolation(plain)).toBe(false);
    expect(db.isUniqueViolation(plain)).toBe(false);
    expect(db.dialect).toBe("sqlite");
  });
});
