import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";

// In-memory idb-keyval + a fake object store, so purgeProjectData can be
// exercised without a real IndexedDB. `idb` is hoisted so the (hoisted)
// vi.mock factory and the test bodies share one store + one call log.
const idb = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  keys: vi.fn(),
  delMany: vi.fn(),
  deleteCalls: [] as unknown[],
  storeCallLog: { count: 0, mode: null as string | null },
  boundCalls: [] as Array<{ lower: string; upper: string }>,
}));

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => idb.store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.store.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.store.delete(key);
  }),
  keys: idb.keys,
  delMany: idb.delMany,
  createStore: vi.fn(
    () =>
      (
        txMode: string,
        callback: (os: {
          delete: (k: unknown) => void;
          transaction: unknown;
        }) => unknown,
      ) => {
        idb.storeCallLog.count++;
        idb.storeCallLog.mode = txMode;
        const objectStore = {
          delete: (key: unknown) => {
            idb.deleteCalls.push(key);
          },
          transaction: {},
        };
        return Promise.resolve(callback(objectStore));
      },
  ),
  promisifyRequest: vi.fn(async (request: unknown) => request),
}));

import { IDBChatPersistenceAdapter } from "../../../src/infrastructure/adapters/idb-chat-persistence.adapter.js";
import type { GovernanceEntry } from "@hexagen/local-llm";

const GOVERNANCE_PREFIX = "hexagen:governance:";
const WIZARD_DRAFT_PREFIX = "hexagen:wizard-draft:";
const WORKSPACE_PREFIX = "hexagen:workspace:";
const GENERATION_PREFIX = "hexagen:generation:";

describe("IDBChatPersistenceAdapter — governance key prefix", () => {
  beforeEach(() => {
    idb.store.clear();
  });

  it("load/save/clear all address hexagen:governance:<contextKey>", async () => {
    const adapter = new IDBChatPersistenceAdapter();
    const contextKey = "projA-step:bounded_contexts:q:abc";
    const entries: GovernanceEntry[] = [
      {
        id: "e1",
        questionLabel: "What about bounded contexts?",
        answer: "They isolate...",
      },
    ];

    const saved = await adapter.saveGovernanceThread(contextKey, entries);
    assert.strictEqual(saved.success, true);
    assert.deepStrictEqual(
      idb.store.get(`${GOVERNANCE_PREFIX}${contextKey}`),
      entries,
    );

    const loaded = await adapter.loadGovernanceThread(contextKey);
    assert.strictEqual(loaded.success, true);
    assert.deepStrictEqual(loaded.value, entries);

    const cleared = await adapter.clearGovernanceThread(contextKey);
    assert.strictEqual(cleared.success, true);
    assert.strictEqual(
      idb.store.has(`${GOVERNANCE_PREFIX}${contextKey}`),
      false,
    );
  });
});

describe("IDBChatPersistenceAdapter.purgeProjectData — one transaction", () => {
  const P = "projX";

  let originalIDBKeyRange: typeof globalThis.IDBKeyRange;

  beforeEach(() => {
    idb.store.clear();
    idb.deleteCalls.length = 0;
    idb.storeCallLog.count = 0;
    idb.storeCallLog.mode = null;
    idb.boundCalls.length = 0;
    idb.keys.mockClear();
    idb.delMany.mockClear();
    // Stub IDBKeyRange.bound so purge uses it but we can inspect the bounds.
    originalIDBKeyRange = globalThis.IDBKeyRange;
    globalThis.IDBKeyRange = {
      bound: (lower: string, upper: string) => {
        const range = { lower, upper };
        idb.boundCalls.push(range);
        return range;
      },
    } as unknown as typeof IDBKeyRange;
  });

  afterEach(() => {
    globalThis.IDBKeyRange = originalIDBKeyRange;
  });

  it("opens exactly one readwrite store() call", async () => {
    const adapter = new IDBChatPersistenceAdapter();
    await adapter.purgeProjectData(P);

    assert.strictEqual(idb.storeCallLog.count, 1, "exactly one store() call");
    assert.strictEqual(idb.storeCallLog.mode, "readwrite");
  });

  it("deletes the two exact keys and the two range bounds, each with the - after the id", async () => {
    const adapter = new IDBChatPersistenceAdapter();
    await adapter.purgeProjectData(P);

    const deletes = idb.deleteCalls;
    assert.strictEqual(deletes.length, 4, "two exact keys + two ranges");

    const exact = deletes.filter((d) => typeof d === "string");
    // Two exact keys: wizard-draft and workspace.
    assert.ok(exact.includes(`${WIZARD_DRAFT_PREFIX}${P}`));
    assert.ok(exact.includes(`${WORKSPACE_PREFIX}${P}`));

    const ranges = deletes.filter((d) => typeof d === "object");
    assert.strictEqual(ranges.length, 2);

    const lowers = (ranges as Array<{ lower: string }>)
      .map((r) => r.lower)
      .sort();
    assert.deepStrictEqual(lowers, [
      `${GENERATION_PREFIX}${P}-`,
      `${GOVERNANCE_PREFIX}${P}-`,
    ]);

    const uppers = (ranges as Array<{ upper: string }>)
      .map((r) => r.upper)
      .sort();
    assert.deepStrictEqual(uppers, [
      `${GENERATION_PREFIX}${P}-\uffff`,
      `${GOVERNANCE_PREFIX}${P}-\uffff`,
    ]);
  });

  it("a sibling id that merely starts with P is outside both range bounds", async () => {
    const adapter = new IDBChatPersistenceAdapter();
    await adapter.purgeProjectData(P);

    assert.ok(idb.boundCalls.length >= 2, "both ranges were constructed");
    const sibling = `${GOVERNANCE_PREFIX}${P}2-step:foo:q:bar`;
    for (const { lower, upper } of idb.boundCalls) {
      // [lower, upper] is "...P-" .. "...P-\uffff". A "...P2-..." key sorts
      // above upper, so it is excluded — the trailing - protects it.
      assert.equal(
        sibling > lower && sibling <= upper,
        false,
        `${sibling} must not fall within [${lower}, ${upper}]`,
      );
    }
  });

  it("never calls keys() or delMany()", async () => {
    const adapter = new IDBChatPersistenceAdapter();
    await adapter.purgeProjectData(P);

    assert.strictEqual(idb.keys.mock.calls.length, 0, "no listing step");
    assert.strictEqual(idb.delMany.mock.calls.length, 0);
  });
});
