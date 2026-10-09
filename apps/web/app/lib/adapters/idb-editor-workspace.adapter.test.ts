import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

const idb = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  getDelay: null as (() => Promise<void>) | null,
}));
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => {
    if (idb.getDelay) await idb.getDelay();
    return idb.store.get(key);
  }),
  set: vi.fn(async (key: string, value: unknown) => {
    idb.store.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idb.store.delete(key);
  }),
  update: vi.fn(async (key: string, updater: (val: unknown) => unknown) => {
    const current = idb.store.get(key);
    idb.store.set(key, updater(current));
  }),
}));

import { IDBEditorWorkspaceAdapter } from "./idb-editor-workspace.adapter";
import { set, update } from "idb-keyval";
import type { PersistedEditorWorkspace } from "@hexagen/shared";

const WORKSPACE_KEY = "hexagen:workspace:";
const LIFT_KEY = "hexagen:workspace-lift";

const ws = (sessionId: string): PersistedEditorWorkspace => ({
  schemaVersion: 1,
  sessionId,
  updatedAt: 100,
  selectedFileId: null,
  files: {},
  unpushed: false,
});

describe("IDBEditorWorkspaceAdapter lift stamp", () => {
  beforeEach(() => {
    idb.store.clear();
    idb.getDelay = null;
  });

  it("round-trips a lift stamp per session id and leaves other ids alone", async () => {
    const adapter = new IDBEditorWorkspaceAdapter();
    const stampA = {
      ownerId: "u1",
      rev: 5,
      syncedUpdatedAt: 100,
      confirmed: true,
      discarded: false,
    };
    const stampB = {
      ownerId: "u1",
      rev: 9,
      syncedUpdatedAt: 200,
      confirmed: false,
      discarded: false,
    };

    await adapter.setLiftStamp("s1", stampA);
    await adapter.setLiftStamp("s2", stampB);

    assert.deepEqual(await adapter.getLiftStamp("s1"), stampA);
    assert.deepEqual(await adapter.getLiftStamp("s2"), stampB);

    // The map shape means both entries coexist under one key:
    const raw = idb.store.get(LIFT_KEY) as Record<string, unknown>;
    assert.ok(raw);
    assert.ok("s1" in raw && "s2" in raw, "both ids present in one map key");
    assert.deepEqual(
      (raw.s1 as { rev: number }).rev,
      5,
      "s2's write did not clobber s1",
    );
  });

  it("two concurrent setLiftStamp calls both land", async () => {
    const adapter = new IDBEditorWorkspaceAdapter();
    idb.getDelay = () => new Promise((resolve) => setTimeout(resolve, 10));

    const stampA = {
      ownerId: "u1",
      rev: 1,
      syncedUpdatedAt: 100,
      confirmed: true,
      discarded: false,
    };
    const stampB = {
      ownerId: "u1",
      rev: 2,
      syncedUpdatedAt: 200,
      confirmed: true,
      discarded: false,
    };

    await Promise.all([
      adapter.setLiftStamp("s1", stampA),
      adapter.setLiftStamp("s2", stampB),
    ]);

    const raw = idb.store.get(LIFT_KEY) as Record<string, unknown>;
    assert.ok(raw);
    assert.ok("s1" in raw && "s2" in raw, "both concurrent writes survived");
    assert.deepEqual((raw.s1 as { rev: number }).rev, 1);
    assert.deepEqual((raw.s2 as { rev: number }).rev, 2);
  });

  it("clearWorkspace removes the stamp entry but not another id's", async () => {
    const adapter = new IDBEditorWorkspaceAdapter();
    await adapter.setLiftStamp("keep", {
      ownerId: "u1",
      rev: 3,
      syncedUpdatedAt: 100,
      confirmed: true,
      discarded: false,
    });
    await adapter.setLiftStamp("gone", {
      ownerId: "u1",
      rev: 7,
      syncedUpdatedAt: 200,
      confirmed: false,
      discarded: false,
    });
    idb.store.set(`${WORKSPACE_KEY}keep`, ws("keep"));
    idb.store.set(`${WORKSPACE_KEY}gone`, ws("gone"));

    await adapter.clearWorkspace("gone");

    assert.equal(idb.store.has(`${WORKSPACE_KEY}gone`), false);
    assert.equal(idb.store.has(`${WORKSPACE_KEY}keep`), true);
    assert.equal(await adapter.getLiftStamp("gone"), null);
    assert.deepEqual(await adapter.getLiftStamp("keep"), {
      ownerId: "u1",
      rev: 3,
      syncedUpdatedAt: 100,
      confirmed: true,
      discarded: false,
    });
  });

  it("setLiftStamp(null) removes only that id's entry", async () => {
    const adapter = new IDBEditorWorkspaceAdapter();
    await adapter.setLiftStamp("s1", {
      ownerId: "u1",
      rev: 1,
      syncedUpdatedAt: 100,
      confirmed: true,
      discarded: false,
    });
    await adapter.setLiftStamp("s2", {
      ownerId: "u1",
      rev: 2,
      syncedUpdatedAt: 200,
      confirmed: true,
      discarded: false,
    });

    await adapter.setLiftStamp("s1", null);

    assert.equal(await adapter.getLiftStamp("s1"), null);
    assert.deepEqual(await adapter.getLiftStamp("s2"), {
      ownerId: "u1",
      rev: 2,
      syncedUpdatedAt: 200,
      confirmed: true,
      discarded: false,
    });
  });
});

describe("IDBEditorWorkspaceAdapter loadWorkspace", () => {
  beforeEach(() => {
    idb.store.clear();
    idb.getDelay = null;
  });

  it("loadWorkspace still ignores a schemaVersion other than 1", async () => {
    const adapter = new IDBEditorWorkspaceAdapter();
    idb.store.set(`${WORKSPACE_KEY}bad`, { ...ws("bad"), schemaVersion: 2 });
    idb.store.set(`${WORKSPACE_KEY}old`, { ...ws("old"), schemaVersion: 0 });

    assert.deepEqual(await adapter.loadWorkspace("bad"), {
      success: true,
      value: null,
    });
    assert.deepEqual(await adapter.loadWorkspace("old"), {
      success: true,
      value: null,
    });
    // A v1 record is still returned.
    idb.store.set(`${WORKSPACE_KEY}good`, ws("good"));
    const good = await adapter.loadWorkspace("good");
    assert.ok(good.success && good.value !== null);
    assert.equal(good.value?.sessionId, "good");
  });
});

describe("IDBEditorWorkspaceAdapter recordConflict", () => {
  beforeEach(() => {
    idb.store.clear();
    update.mockClear();
    set.mockClear();
  });

  it("recordConflict goes through one update() call", async () => {
    const adapter = new IDBEditorWorkspaceAdapter();
    await adapter.recordConflict({
      id: "c1",
      at: new Date().toISOString(),
      where: "load",
      stampRev: 1,
      serverRev: 2,
    });
    assert.equal(update.mock.calls.length, 1, "single update() call");
    assert.equal(update.mock.calls[0]![0], "hexagen:workspace-conflicts");
    // Single transaction: not a read-then-set pair.
    assert.equal(set.mock.calls.length, 0, "no separate set() call");
  });
});
