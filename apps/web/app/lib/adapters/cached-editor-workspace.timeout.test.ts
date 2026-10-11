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

/**
 * A minimal Response for the fake server: status, ok, an optional ETag of
 * the adapter's `"rev:<n>"` shape, and a json() body.
 */
function fakeResponse(status: number, body?: unknown, rev?: number): Response {
  const headers = new Headers();
  if (rev !== undefined) headers.set("ETag", `"rev:${rev}"`);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    json: async () => body,
  } as unknown as Response;
}

/**
 * A fake document server for the no-answer tests. It holds one document
 * `{ rev, payload }` (or null), answers GET/DELETE from it, and can APPLY a
 * PUT — store the payload, bump the rev — and then never answer it (a
 * never-settling promise): the write that may still have landed. Every call
 * is recorded with its method and If-Match header.
 */
function makeNoAnswerServer(
  initial: {
    rev: number;
    payload: unknown;
  } | null,
) {
  const server = {
    doc: initial,
    applyPut: true,
    failGets: false,
    calls: [] as Array<{ method: string; ifMatch: string | null }>,
    holdNextGet: false,
    releaseGet: null as (() => void) | null,
  };
  const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(
      init?.headers as Record<string, string> | undefined,
    );
    server.calls.push({ method, ifMatch: headers.get("If-Match") });
    if (method === "GET") {
      if (server.holdNextGet) {
        server.holdNextGet = false;
        return new Promise<Response>((resolve) => {
          server.releaseGet = () => {
            if (server.failGets) {
              resolve(fakeResponse(500));
            } else if (server.doc === null) {
              resolve(fakeResponse(404));
            } else {
              resolve(
                fakeResponse(
                  200,
                  { payload: server.doc!.payload, updatedAt: 1 },
                  server.doc!.rev,
                ),
              );
            }
          };
        });
      }
      if (server.failGets) return fakeResponse(500);
      if (server.doc === null) return fakeResponse(404);
      return fakeResponse(
        200,
        { payload: server.doc.payload, updatedAt: 1 },
        server.doc.rev,
      );
    }
    if (method === "PUT") {
      if (server.applyPut) {
        const body = JSON.parse(String(init?.body)) as { payload: unknown };
        server.doc = { rev: (server.doc?.rev ?? 0) + 1, payload: body.payload };
      }
      return new Promise<Response>(() => {});
    }
    // DELETE
    if (server.doc === null) return fakeResponse(404);
    if (headers.get("If-Match") === `"rev:${server.doc.rev}"`) {
      server.doc = null;
      return fakeResponse(204);
    }
    return fakeResponse(412, undefined, server.doc.rev);
  }) as unknown as MockedFunction<typeof fetch>;
  return { server, fetch: fetchImpl };
}

describe("a write with no answer that a discard overtook", () => {
  it("save path: the parked write is read back and deleted with the rev it landed on", async () => {
    const { server, fetch } = makeNoAnswerServer({
      rev: 5,
      payload: makeWorkspace(1000),
    });
    const { adapter, cache, warns } = makeAdapters(fetch);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(1_500);
    assert.ok(server.doc, "the document exists");
    assert.equal(server.doc.rev, 6, "the parked PUT was applied at rev 6");
    assert.deepEqual(
      (server.doc.payload as { updatedAt: number }).updatedAt,
      2000,
      "the parked PUT stored the 2000 payload",
    );

    const clearPromise = adapter.clearWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(8_000);
    await clearPromise;

    assert.ok(
      server.calls.some(
        (c) => c.method === "DELETE" && c.ifMatch === '"rev:6"',
      ),
      "a DELETE with If-Match rev:6 was sent",
    );
    assert.equal(server.doc, null, "the server has no document");

    const inCache = await cache.loadWorkspace(UUID);
    assert.ok(inCache.success && inCache.value === null, "cache is empty");

    const putsBeforeLoad = server.calls.filter(
      (c) => c.method === "PUT",
    ).length;
    const loaded = await adapter.loadWorkspace(UUID);
    assert.ok(loaded.success);
    assert.equal(loaded.value, null, "the load answers null");
    assert.equal(
      server.calls.filter((c) => c.method === "PUT").length,
      putsBeforeLoad,
      "no further PUT was sent",
    );
    assert.equal(
      warns.some((w) => w.includes("could not be checked")),
      false,
      "the confirming read succeeded",
    );
  });

  it("save path: a parked write that did NOT land is left alone and the discard deletes rev 5", async () => {
    const { server, fetch } = makeNoAnswerServer({
      rev: 5,
      payload: makeWorkspace(1000),
    });
    server.applyPut = false;
    const { adapter, cache } = makeAdapters(fetch);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(1_500);
    assert.ok(server.doc, "the document exists");
    assert.equal(server.doc.rev, 5, "the parked PUT was NOT applied");

    const clearPromise = adapter.clearWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(8_000);
    await clearPromise;

    assert.equal(
      server.calls.some(
        (c) => c.method === "DELETE" && c.ifMatch === '"rev:6"',
      ),
      false,
      "no DELETE with rev:6 was sent",
    );
    assert.ok(
      server.calls.some(
        (c) => c.method === "DELETE" && c.ifMatch === '"rev:5"',
      ),
      "the discard's own DELETE with If-Match rev:5 was sent",
    );
    assert.equal(server.doc, null, "the document was removed");

    const loaded = await adapter.loadWorkspace(UUID);
    assert.ok(loaded.success);
    assert.equal(loaded.value, null, "the next load answers null");
  });

  it("catch-up path: the load's parked catch-up PUT is read back and deleted", async () => {
    const { server, fetch } = makeNoAnswerServer({
      rev: 5,
      payload: makeWorkspace(1000),
    });
    const { adapter, cache } = makeAdapters(fetch);
    await cache.saveWorkspace(UUID, makeWorkspace(2000));
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });

    const loadPromise = adapter.loadWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(0);
    assert.ok(server.doc, "the document exists");
    assert.equal(
      server.doc.rev,
      6,
      "the parked catch-up PUT was applied at rev 6",
    );

    const clearPromise = adapter.clearWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(8_000);
    const loadResult = await loadPromise;
    await clearPromise;

    assert.ok(
      server.calls.some(
        (c) => c.method === "DELETE" && c.ifMatch === '"rev:6"',
      ),
      "a DELETE with If-Match rev:6 was sent",
    );
    assert.equal(server.doc, null, "the document is gone from the server");
    assert.ok(loadResult.success);
    assert.equal(loadResult.value, null, "the load answered null");
  });

  it("lift path: the load's parked create-only PUT is read back and deleted", async () => {
    const { server, fetch } = makeNoAnswerServer(null);
    const { adapter, cache } = makeAdapters(fetch);
    await cache.saveWorkspace(UUID, makeWorkspace(2000));

    const loadPromise = adapter.loadWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(0);
    assert.ok(server.doc, "the document was created");
    assert.equal(server.doc.rev, 1, "the parked lift PUT was applied at rev 1");

    const clearPromise = adapter.clearWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(8_000);
    const loadResult = await loadPromise;
    await clearPromise;

    assert.ok(
      server.calls.some(
        (c) => c.method === "DELETE" && c.ifMatch === '"rev:1"',
      ),
      "a DELETE with If-Match rev:1 was sent",
    );
    assert.equal(server.doc, null, "the document is gone from the server");
    assert.ok(loadResult.success);
    assert.equal(loadResult.value, null, "the load answered null");
  });

  it("lift path: a copy a later load adopted after the discard ran out is not deleted", async () => {
    const { server, fetch } = makeNoAnswerServer(null);
    const { adapter, cache } = makeAdapters(fetch);
    await cache.saveWorkspace(UUID, makeWorkspace(2000));

    const l1 = adapter.loadWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(0);
    assert.ok(server.doc, "the document was created");
    assert.equal(server.doc.rev, 1, "the parked lift PUT was applied at rev 1");

    server.holdNextGet = true;
    const clear = adapter.clearWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(8_000);
    assert.ok(server.releaseGet, "the confirming GET is parked");
    await vi.advanceTimersByTimeAsync(2_000);
    await clear;
    assert.equal(
      server.calls.some((c) => c.method === "DELETE"),
      false,
      "no DELETE while the confirming GET is parked",
    );

    const l2 = await adapter.loadWorkspace(UUID);
    assert.ok(l2.success, "the load succeeded");
    if (l2.success && l2.value !== null) {
      assert.equal(
        l2.value.updatedAt,
        2000,
        "the adopted copy is the 2000 one",
      );
    }
    const stamp: LiftStamp | null = await cache.getLiftStamp(UUID);
    assert.ok(stamp, "a lift stamp exists");
    assert.equal(stamp!.rev, 1);
    assert.notEqual(
      stamp!.discarded,
      true,
      "the stamp is not a discard marker",
    );

    server.releaseGet!();
    await vi.advanceTimersByTimeAsync(0);
    const r1 = await l1;
    assert.equal(
      server.calls.some((c) => c.method === "DELETE"),
      false,
      "no DELETE after the confirming GET was released",
    );
    assert.ok(server.doc, "the document still exists");
    assert.equal(server.doc!.rev, 1);
    const stampAfter: LiftStamp | null = await cache.getLiftStamp(UUID);
    assert.ok(stampAfter, "the lift stamp is still there");
    assert.equal(stampAfter!.rev, 1);
    const inCache = await cache.loadWorkspace(UUID);
    assert.ok(inCache.success);
    assert.ok(
      inCache.success && inCache.value !== null,
      "the cache still holds the workspace",
    );
    assert.equal(
      inCache.success && inCache.value !== null
        ? inCache.value.updatedAt
        : null,
      2000,
    );
    assert.ok(r1.success, "the first load resolved successfully");
    assert.ok(
      r1.success && r1.value === null,
      `the first load answered a success with a null value (got ${JSON.stringify(r1)})`,
    );
  });

  it("lift path: when no load adopted it, the check still deletes after the discard ran out", async () => {
    const { server, fetch } = makeNoAnswerServer(null);
    const { adapter, cache } = makeAdapters(fetch);
    await cache.saveWorkspace(UUID, makeWorkspace(2000));

    const l1 = adapter.loadWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(0);
    assert.ok(server.doc, "the document was created");
    assert.equal(server.doc.rev, 1);

    server.holdNextGet = true;
    const clear = adapter.clearWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(8_000);
    assert.ok(server.releaseGet, "the confirming GET is parked");
    await vi.advanceTimersByTimeAsync(2_000);
    await clear;
    assert.equal(
      server.calls.some((c) => c.method === "DELETE"),
      false,
      "no DELETE while the confirming GET is parked",
    );

    server.releaseGet!();
    await vi.advanceTimersByTimeAsync(0);
    await l1;
    assert.ok(
      server.calls.some(
        (c) => c.method === "DELETE" && c.ifMatch === '"rev:1"',
      ),
      "a DELETE with If-Match rev:1 was sent",
    );
    assert.equal(server.doc, null, "the document was deleted");
  });

  it("lift path: a later load still in flight keeps the copy", async () => {
    const { server, fetch } = makeNoAnswerServer(null);
    const { adapter, cache } = makeAdapters(fetch);
    await cache.saveWorkspace(UUID, makeWorkspace(2000));

    const l1 = adapter.loadWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(0);
    assert.ok(server.doc, "the document was created");
    assert.equal(server.doc.rev, 1);

    server.holdNextGet = true;
    const clear = adapter.clearWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(8_000);
    assert.ok(server.releaseGet, "the confirming GET is parked");
    await vi.advanceTimersByTimeAsync(2_000);
    await clear;
    assert.equal(
      server.calls.some((c) => c.method === "DELETE"),
      false,
      "no DELETE while the confirming GET is parked",
    );

    const releaseFirst = server.releaseGet!;
    server.holdNextGet = true;
    const l2 = adapter.loadWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(0);
    assert.ok(server.releaseGet, "the second GET is parked too");
    assert.notEqual(
      server.releaseGet,
      releaseFirst,
      "a second release function exists",
    );

    releaseFirst();
    await vi.advanceTimersByTimeAsync(0);
    await l1;
    assert.equal(
      server.calls.some((c) => c.method === "DELETE"),
      false,
      "no DELETE while a load is still in flight",
    );

    server.releaseGet!();
    await vi.advanceTimersByTimeAsync(0);
    const r2 = await l2;
    assert.ok(r2.success, "the second load succeeded");
    assert.ok(server.doc, "the document still exists");
    assert.equal(server.doc!.rev, 1);
  });

  it("a confirming read that fails logs the limit: the write stays on the server", async () => {
    const { server, fetch } = makeNoAnswerServer({
      rev: 5,
      payload: makeWorkspace(1000),
    });
    const { adapter, cache, warns } = makeAdapters(fetch);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(1_500);
    assert.equal(server.doc?.rev, 6, "the parked PUT was applied at rev 6");

    server.failGets = true;
    const clearPromise = adapter.clearWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(8_000);
    const clearResult = await clearPromise;

    assert.ok(clearResult.success, "the discard settles");
    assert.ok(
      warns.some((w) => w.includes("got no answer and could not be checked")),
      "the could-not-be-checked warning was logged",
    );
    assert.ok(server.doc, "the document stays on the server");
    assert.equal(server.doc.rev, 6, "still the write's revision");
  });

  it("no discard: the timed-out save path sends no GET and no DELETE", async () => {
    const { server, fetch } = makeNoAnswerServer({
      rev: 5,
      payload: makeWorkspace(1000),
    });
    const { adapter, cache } = makeAdapters(fetch);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(8_000);

    const methods = server.calls.map((c) => c.method);
    assert.equal(
      methods.filter((m) => m === "GET").length,
      0,
      "no GET was sent",
    );
    assert.equal(
      methods.filter((m) => m === "DELETE").length,
      0,
      "no DELETE was sent",
    );
    assert.deepEqual(methods, ["PUT"], "only the PUT went out");
  });

  it("a server copy another device changed is not deleted: the read keeps it", async () => {
    const { server, fetch } = makeNoAnswerServer({
      rev: 5,
      payload: makeWorkspace(1000),
    });
    server.applyPut = false;
    const { adapter, cache, warns } = makeAdapters(fetch);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(1_500);
    // While the write is parked without an answer, another device writes a
    // different payload at another revision.
    server.doc = { rev: 7, payload: makeWorkspace(3000) };

    const clearPromise = adapter.clearWorkspace(UUID);
    await vi.advanceTimersByTimeAsync(8_000);
    const clearResult = await clearPromise;

    assert.ok(clearResult.success, "the discard settles");
    assert.equal(
      server.calls.some(
        (c) => c.method === "DELETE" && c.ifMatch === '"rev:7"',
      ),
      false,
      "no DELETE with the other device's rev:7 was sent",
    );
    assert.ok(server.doc, "the other device's copy is kept");
    assert.equal(
      (server.doc.payload as { updatedAt: number }).updatedAt,
      3000,
      "still the other device's payload",
    );
    assert.ok(
      warns.some((w) =>
        w.includes("server copy changed on another device, not deleted"),
      ),
      "the conflict warning was logged",
    );
  });
});
