import { describe, it, vi, beforeEach, afterEach, expect } from "vitest";
import assert from "node:assert/strict";
import type { MockedFunction } from "vitest";

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
import type { LiftStamp } from "./idb-editor-workspace.adapter";
import {
  CachedEditorWorkspaceAdapter,
  HttpEditorWorkspaceAdapter,
} from "./http-editor-workspace.adapter";
import type { PersistedEditorWorkspace } from "@hexagen/shared";

const UUID = "11111111-1111-4111-8111-111111111111";

function makeWorkspace(
  updatedAt = 1000,
  sessionId = UUID,
  files: Record<string, unknown> = {},
): PersistedEditorWorkspace {
  return {
    schemaVersion: 1,
    sessionId,
    updatedAt,
    selectedFileId: null,
    files: files as PersistedEditorWorkspace["files"],
    unpushed: false,
  };
}

function warnCollector() {
  const warns: string[] = [];
  const logger = {
    info: () => {},
    warn: (msg: string) => warns.push(msg),
    error: () => {},
    debug: () => {},
    errorWithException: () => {},
  };
  return { warns, logger };
}

type Handler = (init?: RequestInit) => Promise<Response>;

/**
 * A vi.fn answering GET/PUT/DELETE from a small map; a method without a
 * handler never settles (the parked request of the test).
 */
function makeFetch(
  handlers: Record<string, Handler>,
): MockedFunction<typeof fetch> {
  return vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const handler = handlers[method];
    if (handler) return handler(init);
    return new Promise<Response>(() => {});
  }) as unknown as MockedFunction<typeof fetch>;
}

function makeAdapters(fetchImpl: MockedFunction<typeof fetch>): {
  adapter: CachedEditorWorkspaceAdapter;
  cache: IDBEditorWorkspaceAdapter;
  warns: string[];
} {
  const cache = new IDBEditorWorkspaceAdapter();
  const remote = new HttpEditorWorkspaceAdapter(fetchImpl, 8_000);
  const { warns, logger } = warnCollector();
  const adapter = new CachedEditorWorkspaceAdapter(
    cache,
    remote,
    () => null,
    () => Promise.resolve("user-1"),
    logger,
  );
  return { adapter, cache, warns };
}

beforeEach(() => {
  idb.store.clear();
  idb.getDelay = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CachedEditorWorkspaceAdapter with a timed-out remote", () => {
  it("a load whose GET never answers settles after 8 s with the browser copy and sends no PUT", async () => {
    const browserCopy = makeWorkspace(1000);
    const fetchImpl = makeFetch({});
    const { adapter, cache } = makeAdapters(fetchImpl);
    await cache.saveWorkspace(UUID, browserCopy);

    let settled = false;
    const pending = adapter.loadWorkspace(UUID).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;
    assert.equal(settled, true, "settles after the 8 s request limit");
    assert.ok(result.success);
    assert.ok(result.value);
    assert.equal(result.value!.updatedAt, 1000);
    const methods = fetchImpl.mock.calls.map((c) =>
      (c[1]?.method ?? "GET").toUpperCase(),
    );
    assert.deepEqual(methods, ["GET"]);
    assert.equal(
      methods.filter((m) => m === "PUT").length,
      0,
      "no PUT was sent",
    );
  });

  it("a discard whose DELETE never answers settles after 8 s, empties the cache and keeps a discard marker", async () => {
    const fetchImpl = makeFetch({});
    const { adapter, cache } = makeAdapters(fetchImpl);
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });

    let settled = false;
    const pending = adapter.clearWorkspace(UUID).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;
    assert.equal(settled, true, "settles after the 8 s request limit");
    assert.ok(result.success);

    const inCache = await cache.loadWorkspace(UUID);
    assert.ok(inCache.success && inCache.value === null, "cache is empty");

    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp, "a stamp remains");
    expect(stamp!.discarded).toBe(true);
    assert.equal(stamp!.rev, 5);
  });

  it("a discard waiting for a load parked on a GET settles after 8 s (not 10) and logs no overrun warning", async () => {
    const fetchImpl = makeFetch({});
    const { adapter, cache, warns } = makeAdapters(fetchImpl);
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    const loadPromise = adapter.loadWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(1);
    let settled = false;
    const clearPromise = adapter.clearWorkspace(UUID).then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(7_998);
    assert.equal(settled, false, "still waiting just before the limit");
    await vi.advanceTimersByTimeAsync(1);
    const clearResult = await clearPromise;
    assert.equal(settled, true, "settles after 8 s of fake time");
    assert.ok(clearResult.success);
    await loadPromise;
    assert.equal(
      warns.some((w) => w.includes("discard went on after")),
      false,
      "the overrun warning was NOT logged",
    );
  });
});
