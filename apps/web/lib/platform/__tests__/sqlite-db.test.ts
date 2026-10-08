import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import type { PlatformDb, PlatformDbSession } from "../db";

describe("sqlite-db", () => {
  let db: PlatformDb;
  let handle: Database.Database;

  beforeEach(() => {
    handle = openPlatformDb(":memory:");
    handle.exec(
      "CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT, val INTEGER)",
    );
    db = createSqlitePlatformDb(handle);
  });

  it("1: all/get/run work with positional and named parameters; run reports changes", async () => {
    await db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
      1,
      "a",
      10,
    ]);
    await db.run("INSERT INTO test (id, name, val) VALUES ($id, $name, $val)", {
      id: 2,
      name: "b",
      val: 20,
    });

    const rows = await db.all<{ id: number; name: string; val: number }>(
      "SELECT * FROM test ORDER BY id",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("a");

    const one = await db.get<{ id: number; name: string; val: number }>(
      "SELECT * FROM test WHERE id = ?",
      [2],
    );
    expect(one?.name).toBe("b");

    const result = await db.run(
      "UPDATE test SET val = ? WHERE id = ?",
      [30, 1],
    );
    expect(result.changes).toBe(1);

    const updated = await db.get<{ val: number }>(
      "SELECT val FROM test WHERE id = ?",
      [1],
    );
    expect(updated?.val).toBe(30);
  });

  it("2: a transaction that resolves commits its rows", async () => {
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        1,
        "a",
        10,
      ]);
    });
    const rows = await db.all<{ id: number }>("SELECT * FROM test");
    expect(rows).toHaveLength(1);
  });

  it("3: a transaction whose callback rejects AFTER an await leaves no row, rethrowing the SAME error", async () => {
    const err = new Error("boom");
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
          1,
          "a",
          10,
        ]);
        await Promise.resolve();
        throw err;
      }),
    ).rejects.toBe(err);

    const rows = await db.all("SELECT * FROM test");
    expect(rows).toHaveLength(0);
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

  it("5b: isUniqueViolation detects sqlite unique-constraint errors", async () => {
    await db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
      1,
      "a",
      10,
    ]);
    let dupErr: unknown = undefined;
    try {
      await db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        1,
        "b",
        20,
      ]);
    } catch (e) {
      dupErr = e;
    }
    expect(db.isUniqueViolation(dupErr)).toBe(true);

    // unrelated errors are not unique violations
    expect(db.isUniqueViolation(new Error("not a constraint"))).toBe(false);
    expect(db.isUniqueViolation({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" })).toBe(
      false,
    );
    expect(db.isUniqueViolation(undefined)).toBe(false);
    expect(db.isUniqueViolation(null)).toBe(false);
    expect(db.isUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(
      true,
    );
    expect(db.isUniqueViolation({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" })).toBe(
      true,
    );
  });

  it("6: after a transaction rejects, a following transaction and a following plain run both succeed", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
          1,
          "a",
          10,
        ]);
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    // Following transaction must run normally.
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        2,
        "b",
        20,
      ]);
    });

    // Following plain run must run normally too.
    await db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
      3,
      "c",
      30,
    ]);

    const rows = await db.all<{ id: number }>("SELECT * FROM test ORDER BY id");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual([2, 3]);
  });

  it("7: using tx after its transaction ended rejects and writes nothing", async () => {
    let captured: PlatformDbSession | undefined;
    await db.transaction(async (tx) => {
      captured = tx;
    });

    await expect(
      captured!.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        2,
        "b",
        20,
      ]),
    ).rejects.toThrow("transaction is finished");

    const rows = await db.all<{ id: number }>("SELECT * FROM test");
    expect(rows).toHaveLength(0);
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

  it(
    "1a: a plain db.run inside a callback rejects, rolls back, and does not wedge",
    { timeout: 2000 },
    async () => {
      await expect(
        db.transaction(async () => {
          await expect(
            db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
              1,
              "a",
              10,
            ]),
          ).rejects.toThrow("plain db call inside a transaction");
          throw new Error("callback lets an error escape");
        }),
      ).rejects.toThrow("callback lets an error escape");

      // the transaction rolled back:
      const rows = await db.all<{ id: number }>("SELECT * FROM test");
      expect(rows).toHaveLength(0);

      // nothing is wedged: a following plain call and transaction both succeed
      await db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        2,
        "b",
        20,
      ]);
      await db.transaction(async (tx) => {
        await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
          3,
          "c",
          30,
        ]);
      });
      const rows2 = await db.all<{ id: number }>(
        "SELECT * FROM test ORDER BY id",
      );
      expect(rows2.map((r) => r.id)).toEqual([2, 3]);
    },
  );

  it("1b: db.transaction called inside a callback rejects with the nested error", async () => {
    await expect(
      db.transaction(async () => {
        await db.transaction(async () => {});
      }),
    ).rejects.toThrow("Nested transactions are not supported");
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

  it("a plain call from a context that outlived its transaction is accepted", async () => {
    let later: Promise<void> = Promise.resolve();
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
        1,
        "a",
        10,
      ]);
      later = new Promise<void>((resolve, reject) =>
        setTimeout(() => {
          db.get("SELECT 1 AS one").then(() => resolve(), reject);
        }, 20),
      );
    });
    await later;
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
    const runPromise = db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
      2,
      "b",
      20,
    ]);
    const count = handle
      .prepare("SELECT COUNT(*) AS n FROM test")
      .get() as { n: number };
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
    const runPromise = db.run("INSERT INTO test (id, name, val) VALUES (?, ?, ?)", [
      2,
      "b",
      20,
    ]);
    const count = handle
      .prepare("SELECT COUNT(*) AS n FROM test")
      .get() as { n: number };
    expect(count.n).toBe(1);
    await runPromise;
  });

  it("close is safe to call twice: the second call resolves without throwing", async () => {
    await db.close();
    // Second close must not reject — better-sqlite3 throws on a closed handle.
    const second = db.close();
    expect(second).toBeInstanceOf(Promise);
    await expect(second).resolves.toBeUndefined();
  });
});
