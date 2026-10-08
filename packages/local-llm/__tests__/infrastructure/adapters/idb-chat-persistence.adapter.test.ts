import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

// In-memory idb-keyval, mirroring apps/web's idb-saved-projects.adapter.test.ts
// pattern. `idb` is hoisted so the (hoisted) vi.mock factory and the test bodies
// share one store + one delMany call log.
const idb = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  delManyCalls: [] as Array<string[]>,
}));

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => idb.store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.store.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.store.delete(key);
  }),
  keys: vi.fn(async () => Array.from(idb.store.keys())),
  delMany: vi.fn(async (keysToDelete: string[]) => {
    idb.delManyCalls.push([...keysToDelete]);
    keysToDelete.forEach((k) => idb.store.delete(k));
  }),
}));

import { IDBChatPersistenceAdapter } from "../../../src/infrastructure/adapters/idb-chat-persistence.adapter.js";
import type { GovernanceEntry } from "@hexagen/local-llm";

const GOVERNANCE_PREFIX = "hexagen:governance:";
const WIZARD_DRAFT_PREFIX = "hexagen:wizard-draft:";
const WORKSPACE_PREFIX = "hexagen:workspace:";
const GENERATION_PREFIX = "hexagen:generation:";
const CHAT_HISTORY_KEY = "hexagen:chat-history";

describe("IDBChatPersistenceAdapter — governance key prefix", () => {
  beforeEach(() => {
    idb.store.clear();
    idb.delManyCalls.length = 0;
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

    const raw = idb.store.get(`${GOVERNANCE_PREFIX}${contextKey}`);
    assert.deepStrictEqual(raw, entries);

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

describe("IDBChatPersistenceAdapter.purgeProjectData", () => {
  const P = "projX";

  beforeEach(() => {
    idb.store.clear();
    idb.delManyCalls.length = 0;
  });

  /** Seed storage with P's keys, sibling keys, a bare old-style key, and chat. */
  function seedStorage() {
    // P — four key shapes (plus a second governance key to prove the range).
    idb.store.set(`${WIZARD_DRAFT_PREFIX}${P}`, { draft: 1 });
    idb.store.set(`${WORKSPACE_PREFIX}${P}`, { ws: 1 });
    idb.store.set(`${GOVERNANCE_PREFIX}${P}-step:foo:q:bar`, [
      { id: "e1", questionLabel: "q", answer: "a" },
    ]);
    idb.store.set(`${GOVERNANCE_PREFIX}${P}-violation:v-1:q:follow`, [
      { id: "e2", questionLabel: "q2", answer: "a2" },
    ]);
    idb.store.set(`${GENERATION_PREFIX}${P}-gen-1`, { result: true });

    // Sibling project P2 (a project whose id is a prefix-extension of P).
    idb.store.set(`${WIZARD_DRAFT_PREFIX}${P}2`, { draft: 2 });
    idb.store.set(`${WORKSPACE_PREFIX}${P}2`, { ws: 2 });
    idb.store.set(`${GOVERNANCE_PREFIX}${P}2-step:foo:q:bar`, [
      { id: "sib", questionLabel: "q", answer: "a" },
    ]);
    idb.store.set(`${GENERATION_PREFIX}${P}2-gen-1`, { result: true });

    // An unrelated project.
    idb.store.set(`${GOVERNANCE_PREFIX}projY-step:bar:q:1`, [
      { id: "u", questionLabel: "q", answer: "a" },
    ]);

    // The bare, old-style governance key (no project) — must survive.
    idb.store.set(`${GOVERNANCE_PREFIX}step:foo:q:bar`, [
      { id: "legacy", questionLabel: "q", answer: "a" },
    ]);

    // The chat-history key — must survive (not in scope for this lane).
    idb.store.set(CHAT_HISTORY_KEY, []);
  }

  it("deletes all four key shapes belonging to P", async () => {
    seedStorage();
    const adapter = new IDBChatPersistenceAdapter();

    const result = await adapter.purgeProjectData(P);
    assert.strictEqual(result.success, true);

    assert.strictEqual(
      idb.store.has(`${WIZARD_DRAFT_PREFIX}${P}`),
      false,
      "wizard draft for P removed",
    );
    assert.strictEqual(
      idb.store.has(`${WORKSPACE_PREFIX}${P}`),
      false,
      "workspace for P removed",
    );
    for (const key of idb.store.keys()) {
      assert.ok(
        !(
          key.startsWith(`${GOVERNANCE_PREFIX}${P}-`) ||
          key.startsWith(`${GENERATION_PREFIX}${P}-`)
        ),
        `unexpected P key left behind: ${key}`,
      );
    }
  });

  it("leaves P2, a bare old-style governance key and chat-history untouched", async () => {
    seedStorage();
    const adapter = new IDBChatPersistenceAdapter();
    await adapter.purgeProjectData(P);

    // Sibling project P2 survives — the `-` after P must not match P2.
    assert.strictEqual(idb.store.has(`${WIZARD_DRAFT_PREFIX}${P}2`), true);
    assert.strictEqual(idb.store.has(`${WORKSPACE_PREFIX}${P}2`), true);
    assert.deepStrictEqual(
      idb.store.get(`${GOVERNANCE_PREFIX}${P}2-step:foo:q:bar`),
      [{ id: "sib", questionLabel: "q", answer: "a" }],
    );
    assert.strictEqual(idb.store.has(`${GENERATION_PREFIX}${P}2-gen-1`), true);

    // Unrelated project survives.
    assert.strictEqual(
      idb.store.has(`${GOVERNANCE_PREFIX}projY-step:bar:q:1`),
      true,
    );

    // Bare old-style governance key survives (no project attribution).
    assert.strictEqual(
      idb.store.has(`${GOVERNANCE_PREFIX}step:foo:q:bar`),
      true,
      "bare pre-change governance key survives",
    );

    // Chat history survives — out of scope for this lane.
    assert.strictEqual(idb.store.has(CHAT_HISTORY_KEY), true);
  });

  it("makes exactly one delMany call containing exactly P's keys", async () => {
    seedStorage();
    const adapter = new IDBChatPersistenceAdapter();
    await adapter.purgeProjectData(P);

    assert.strictEqual(idb.delManyCalls.length, 1, "exactly one delMany call");
    const deleted = idb.delManyCalls[0];

    // Every deleted key belongs to P (one of the four shapes).
    for (const key of deleted) {
      assert.ok(
        key === `${WIZARD_DRAFT_PREFIX}${P}` ||
          key === `${WORKSPACE_PREFIX}${P}` ||
          key.startsWith(`${GOVERNANCE_PREFIX}${P}-`) ||
          key.startsWith(`${GENERATION_PREFIX}${P}-`),
        `delMany deleted a key that is not P's: ${key}`,
      );
    }

    // No P2 / sibling / bare / chat-history key was passed to delMany.
    assert.equal(
      deleted.find((k) => k.includes(`${P}2`) || k.includes("projY")),
      undefined,
    );
    assert.equal(
      deleted.find((k) => k === `${GOVERNANCE_PREFIX}step:foo:q:bar`),
      undefined,
    );
    assert.equal(
      deleted.find((k) => k === CHAT_HISTORY_KEY),
      undefined,
    );

    // Counts match: 1 wizard + 1 workspace + 2 governance + 1 generation.
    assert.strictEqual(deleted.length, 5);
  });

  it("is a no-op (no delMany) when the project has no keys", async () => {
    idb.store.set(CHAT_HISTORY_KEY, []);
    idb.store.set(`${GOVERNANCE_PREFIX}step:foo:q:bar`, []);
    const adapter = new IDBChatPersistenceAdapter();
    await adapter.purgeProjectData(P);

    assert.strictEqual(
      idb.delManyCalls.length,
      0,
      "no delMany when nothing to delete",
    );
    assert.strictEqual(idb.store.size, 2, "only the unrelated keys remain");
  });
});
