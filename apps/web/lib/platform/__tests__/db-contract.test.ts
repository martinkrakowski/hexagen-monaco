// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { createTestPgDb } from "../../../test-support/pg-test-db";
import type { PlatformDb, PlatformDbSession } from "../db";

class Boom extends Error {
  name = "Boom";
}

type Backend = {
  db: PlatformDb;
  cleanup: () => Promise<void>;
};

async function makeSqlite(): Promise<Backend> {
  const handle = openPlatformDb(":memory:");
  const db = createSqlitePlatformDb(handle);
  await db.run(
    "CREATE TABLE contract_t (id integer PRIMARY KEY, name text, val integer)",
  );
  await db.run(
    "CREATE TABLE contract_child (id integer PRIMARY KEY, tid integer NOT NULL, FOREIGN KEY (tid) REFERENCES contract_t(id))",
  );
  return {
    db,
    cleanup: async () => {
      await db.close();
    },
  };
}

async function makePg(): Promise<Backend> {
  const { db, drop } = await createTestPgDb();
  await db.run(
    "CREATE TABLE contract_t (id integer PRIMARY KEY, name text, val integer)",
  );
  await db.run(
    "CREATE TABLE contract_child (id integer PRIMARY KEY, tid integer NOT NULL, FOREIGN KEY (tid) REFERENCES contract_t(id))",
  );
  return {
    db,
    cleanup: async () => {
      await db.close();
      await drop();
    },
  };
}

const backends: Array<[string, () => Promise<Backend>]> = [
  ["sqlite", makeSqlite],
  ["postgres", makePg],
];

describe.each(backends)("db contract: %s", (name, make) => {
  let db: PlatformDb;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await make();
    db = result.db;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("positional and @name parameters; a name used twice; an extra key is ignored; a missing key rejects", async () => {
    await db.run("INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)", [
      1,
      "a",
      10,
    ]);
    await db.run(
      "INSERT INTO contract_t (id, name, val) VALUES (@id, @name, @val)",
      {
        id: 2,
        name: "b",
        val: 20,
      },
    );

    // a name used twice
    const row = await db.get<{ a: string; b: string }>(
      "SELECT @name AS a, @name AS b",
      { name: "dup" },
    );
    expect(row).toEqual({ a: "dup", b: "dup" });

    // an extra key is ignored
    await db.run(
      "INSERT INTO contract_t (id, name, val) VALUES (@id, @name, @val)",
      {
        id: 3,
        name: "c",
        val: 30,
        extra: "ignored",
      },
    );
    const rows = await db.all<{ id: number; name: string; val: number }>(
      "SELECT * FROM contract_t ORDER BY id",
    );
    expect(rows).toHaveLength(3);

    // a missing key rejects
    await expect(
      db.run(
        "INSERT INTO contract_t (id, name, val) VALUES (@id, @name, @val)",
        {
          id: 4,
          name: "d",
        },
      ),
    ).rejects.toThrow();
  });

  it("run reports changes (1, 0, many)", async () => {
    let result = await db.run(
      "INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)",
      [1, "a", 10],
    );
    expect(result.changes).toBe(1);

    result = await db.run(
      "UPDATE contract_t SET val = ? WHERE id = ?",
      [99, 999],
    );
    expect(result.changes).toBe(0);

    result = await db.run(
      "INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)",
      [2, "b", 20, 3, "c", 30, 4, "d", 40],
    );
    expect(result.changes).toBe(3);
  });

  it("get of no row is undefined", async () => {
    const row = await db.get("SELECT * FROM contract_t WHERE id = 999");
    expect(row).toBeUndefined();
  });

  it("a transaction that resolves commits", async () => {
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)", [
        1,
        "a",
        10,
      ]);
    });
    const rows = await db.all<{ id: number }>("SELECT * FROM contract_t");
    expect(rows).toHaveLength(1);
  });

  it("a callback that rejects after an await leaves no row, rethrowing the SAME error object", async () => {
    const err = new Error("boom");
    await expect(
      db.transaction(async (tx) => {
        await tx.run(
          "INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)",
          [1, "a", 10],
        );
        await Promise.resolve();
        throw err;
      }),
    ).rejects.toBe(err);

    const rows = await db.all("SELECT * FROM contract_t");
    expect(rows).toHaveLength(0);
  });

  it("a typed error thrown in a callback is rethrown, the callback ran once, nothing was written", async () => {
    let callCount = 0;
    await expect(
      db.transaction(async (tx) => {
        callCount++;
        await tx.run(
          "INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)",
          [1, "a", 10],
        );
        throw new Boom("typed error");
      }),
    ).rejects.toThrow("typed error");

    expect(callCount).toBe(1);
    const rows = await db.all("SELECT * FROM contract_t");
    expect(rows).toHaveLength(0);
  });

  it("a plain call inside a callback is rejected", async () => {
    await expect(
      db.transaction(async () => {
        await expect(
          db.run("INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)", [
            1,
            "a",
            10,
          ]),
        ).rejects.toThrow("plain db call inside a transaction");
        throw new Error("callback lets an error escape");
      }),
    ).rejects.toThrow("callback lets an error escape");

    // the transaction rolled back:
    const rows = await db.all<{ id: number }>("SELECT * FROM contract_t");
    expect(rows).toHaveLength(0);

    // nothing is wedged: a following plain call and transaction both succeed
    await db.run("INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)", [
      2,
      "b",
      20,
    ]);
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)", [
        3,
        "c",
        30,
      ]);
    });
    const rows2 = await db.all<{ id: number }>(
      "SELECT * FROM contract_t ORDER BY id",
    );
    expect(rows2.map((r) => r.id)).toEqual([2, 3]);
  });

  it("a nested transaction inside a callback is rejected", async () => {
    await expect(
      db.transaction(async () => {
        await db.transaction(async () => {});
      }),
    ).rejects.toThrow("Nested transactions are not supported");
  });

  it("a tx kept after the transaction rejects", async () => {
    let captured: PlatformDbSession | undefined;
    await db.transaction(async (tx) => {
      captured = tx;
    });

    await expect(
      captured!.run("INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)", [
        1,
        "a",
        10,
      ]),
    ).rejects.toThrow("transaction is finished");

    const rows = await db.all<{ id: number }>("SELECT * FROM contract_t");
    expect(rows).toHaveLength(0);
  });

  it("a plain call from a timer started inside a callback and firing after it is accepted", async () => {
    let later: Promise<void> = Promise.resolve();
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)", [
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

  it("rejects named params given to a statement with none (postgres only)", async () => {
    if (db.dialect !== "postgres") return;
    await expect(db.run("SELECT 1 AS one", { key: "value" })).rejects.toThrow(
      "named parameters were given to a statement that has none",
    );
  });

  it("isUniqueViolation and isForeignKeyViolation each recognise their own violation and not the other's", async () => {
    await db.run("INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)", [
      1,
      "a",
      10,
    ]);

    // unique violation (duplicate PK)
    let ukErr: unknown;
    try {
      await db.run("INSERT INTO contract_t (id, name, val) VALUES (?, ?, ?)", [
        1,
        "b",
        20,
      ]);
    } catch (e) {
      ukErr = e;
    }
    expect(ukErr).toBeDefined();
    expect(db.isUniqueViolation(ukErr)).toBe(true);
    expect(db.isForeignKeyViolation(ukErr)).toBe(false);

    // foreign key violation
    let fkErr: unknown;
    try {
      await db.run(
        "INSERT INTO contract_child (id, tid) VALUES (?, ?)",
        [1, 999],
      );
    } catch (e) {
      fkErr = e;
    }
    expect(fkErr).toBeDefined();
    expect(db.isForeignKeyViolation(fkErr)).toBe(true);
    expect(db.isUniqueViolation(fkErr)).toBe(false);

    // neither recognises a plain error
    const plain = new Error("not a constraint");
    expect(db.isUniqueViolation(plain)).toBe(false);
    expect(db.isForeignKeyViolation(plain)).toBe(false);
  });

  it("dialect is the backend's name", () => {
    expect(db.dialect).toBe(name);
  });

  it("close() twice resolves", async () => {
    await db.close();
    await expect(db.close()).resolves.toBeUndefined();
  });
});
