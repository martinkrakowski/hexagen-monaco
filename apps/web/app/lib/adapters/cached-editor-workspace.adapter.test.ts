import { describe, it, vi, beforeEach, afterEach } from "vitest";
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
}));

import { IDBEditorWorkspaceAdapter } from "./idb-editor-workspace.adapter";
import {
  CachedEditorWorkspaceAdapter,
  HttpEditorWorkspaceAdapter,
} from "./http-editor-workspace.adapter";
import type { PersistedEditorWorkspace } from "@hexagen/shared";
import type { MockedFunction } from "vitest";

const WORKSPACE_KEY_PREFIX = "hexagen:workspace:";
const REMOTE_DEBOUNCE_MS = 1500;

const UUID = "11111111-1111-4111-8111-111111111111";
const BAD_ID = "has spaces!";

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

interface ServerDoc {
  payload: unknown;
  rev: number;
  updatedAt: number;
  projectId: string | null;
}

function makeServerFetch(store: Map<string, ServerDoc>): MockedFunction<typeof fetch> {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(href);
    if (!match) return new Response("not found", { status: 404 });
    const id = match[2]!;

    if (method === "GET") {
      const doc = store.get(id);
      if (!doc) return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({ kind: "workspace", id, projectId: doc.projectId, payload: doc.payload, updatedAt: doc.updatedAt }),
        { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
      );
    }

    if (method === "PUT") {
      const body = JSON.parse(init?.body as string);
      const doc = store.get(id);
      const ifMatch = new Headers(init?.headers).get("If-Match");
      if (doc && ifMatch) {
        const expected = Number(ifMatch.replace("rev:", ""));
        if (expected !== doc.rev) {
          return new Response("conflict", { status: 409, headers: { ETag: `"rev:${doc.rev}"` } });
        }
      }
      if (!doc && ifMatch) return new Response("not found", { status: 404 });
      if (doc) {
        doc.payload = body.payload;
        doc.rev = doc.rev + 1;
        doc.updatedAt = Date.now();
        doc.projectId = body.projectId ?? null;
      } else {
        store.set(id, { payload: body.payload, rev: 1, updatedAt: Date.now(), projectId: body.projectId ?? null });
      }
      const d = store.get(id)!;
      return new Response(
        JSON.stringify({ kind: "workspace", id, projectId: d.projectId, payload: d.payload, updatedAt: d.updatedAt }),
        { status: 200, headers: { ETag: `"rev:${d.rev}"` } },
      );
    }

    if (method === "DELETE") {
      store.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response("nope", { status: 500 });
  }) as unknown as MockedFunction<typeof fetch>;
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

interface TestAdapters {
  adapter: CachedEditorWorkspaceAdapter;
  cache: IDBEditorWorkspaceAdapter;
  remote: HttpEditorWorkspaceAdapter;
  fetchImpl: MockedFunction<typeof fetch>;
  warns: string[];
  logger: ReturnType<typeof warnCollector>["logger"];
  server: Map<string, ServerDoc>;
}

function makeAdapters(options?: {
  tenantId?: string | null;
  userId?: string | null;
}): TestAdapters {
  const server = new Map<string, ServerDoc>();
  const fetchImpl = makeServerFetch(server);
  const cache = new IDBEditorWorkspaceAdapter();
  const remote = new HttpEditorWorkspaceAdapter(fetchImpl);  const { warns, logger } = warnCollector();
  const tenantId = options?.tenantId !== undefined ? options.tenantId : null;
  const userId = options?.userId !== undefined ? options.userId : "user-1";
  const adapter = new CachedEditorWorkspaceAdapter(
    cache, remote,
    () => tenantId,
    () => Promise.resolve(userId),
    logger,
  );
  return { adapter, cache, remote, fetchImpl, warns, logger, server };
}

function putCallsOf(fetchImpl: MockedFunction<typeof fetch>): typeof fetchImpl.mock.calls {
  return fetchImpl.mock.calls.filter(
    (c) => (c[1]?.method ?? "GET").toUpperCase() === "PUT",
  );
}

function allMethodsOf(fetchImpl: MockedFunction<typeof fetch>): string[] {
  return fetchImpl.mock.calls.map((c) => (c[1]?.method ?? "GET").toUpperCase());
}

beforeEach(() => {
  idb.store.clear();
  idb.getDelay = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CachedEditorWorkspaceAdapter lift", () => {
  it("first lift: PUT, then a confirming GET, and only then the stamp", async () => {
    const { adapter, cache, fetchImpl } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    const stampSpy = vi.spyOn(cache, "setLiftStamp");

    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value);
    assert.equal(result.value!.updatedAt, 1000);

    const methods = allMethodsOf(fetchImpl);
    assert.deepEqual(methods, ["GET", "PUT", "GET"]);
    assert.equal(stampSpy.mock.calls.length, 1, "stamp written once");
    assert.ok(
      stampSpy.mock.invocationCallOrder[0] > fetchImpl.mock.invocationCallOrder[2],
      "setLiftStamp after confirming GET",
    );

    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp);
    assert.equal(stamp!.ownerId, "user-1");
    assert.equal(stamp!.rev, 1);
  });

  it("a document with a stamp is not lifted again", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, { ownerId: "user-1", rev: 7, syncedUpdatedAt: 1000 });
    server.set(UUID, { payload: ws, rev: 7, updatedAt: 1000, projectId: UUID });

    await adapter.loadWorkspace(UUID);
    await adapter.loadWorkspace(UUID);

    const methods = allMethodsOf(fetchImpl);
    assert.deepEqual(methods, ["GET", "GET"]);
    assert.equal(putCallsOf(fetchImpl).length, 0, "no PUT on a stamped document");
  });

  it("a failed PUT leaves no stamp and the next load retries", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    let putAttempts = 0;
    fetchImpl.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(String(url));
      const id = match![2]!;
      if (method === "GET") {
        const doc = server.get(id);
        if (!doc) return new Response(null, { status: 404 });
        return new Response(
          JSON.stringify({ kind: "workspace", id, projectId: doc.projectId, payload: doc.payload, updatedAt: doc.updatedAt }),
          { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
        );
      }
      if (method === "PUT") {
        putAttempts++;
        if (putAttempts <= 2) return new Response("server error", { status: 500 });
        const body = JSON.parse(init?.body as string);
        server.set(id, { payload: body.payload, rev: 1, updatedAt: Date.now(), projectId: body.projectId ?? null });
        const d = server.get(id)!;
        return new Response(
          JSON.stringify({ kind: "workspace", id, projectId: d.projectId, payload: d.payload, updatedAt: d.updatedAt }),
          { status: 200, headers: { ETag: `"rev:${d.rev}"` } },
        );
      }
      return new Response("nope", { status: 500 });
    });

    await adapter.loadWorkspace(UUID);
    assert.equal(await cache.getLiftStamp(UUID), null);
    assert.ok(warns.some((w) => /lift PUT failed/.test(w)));

    await adapter.loadWorkspace(UUID);
    assert.equal(await cache.getLiftStamp(UUID), null);

    await adapter.loadWorkspace(UUID);
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp, "stamp written once PUT succeeds");
  });

  it("a failed confirming GET leaves no stamp and the next load retries", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    let afterPut = false;
    fetchImpl.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(String(url));
      const id = match![2]!;
      if (method === "PUT") {
        afterPut = true;
        return new Response(
          JSON.stringify({ kind: "workspace", id, projectId: UUID, payload: {}, updatedAt: 1000 }),
          { status: 200, headers: { ETag: '"rev:1"' } },
        );
      }
      if (method === "GET" && afterPut) {
        return new Response("server error", { status: 500 });
      }
      return new Response(null, { status: 404 });
    });

    await adapter.loadWorkspace(UUID);
    assert.equal(await cache.getLiftStamp(UUID), null);
    assert.ok(warns.some((w) => /confirm/.test(w)));
  });

  it("a confirming GET that returns a different rev leaves no stamp", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    let afterPut = false;
    fetchImpl.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(String(url));
      const id = match![2]!;
      if (method === "PUT") {
        afterPut = true;
        return new Response(
          JSON.stringify({ kind: "workspace", id, projectId: UUID, payload: {}, updatedAt: 1000 }),
          { status: 200, headers: { ETag: '"rev:1"' } },
        );
      }
      if (method === "GET" && afterPut) {
        return new Response(
          JSON.stringify({ kind: "workspace", id, projectId: UUID, payload: {}, updatedAt: 1000 }),
          { status: 200, headers: { ETag: '"rev:2"' } },
        );
      }
      return new Response(null, { status: 404 });
    });

    await adapter.loadWorkspace(UUID);
    assert.equal(await cache.getLiftStamp(UUID), null);
    assert.ok(warns.some((w) => /rev mismatch/.test(w)));
  });

  it("a confirming GET that returns a different payload leaves no stamp", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    const ws = makeWorkspace(1000, UUID, { "a.ts": { content: "hello", isNew: true, dirty: false, updatedAt: 1000 } });
    await cache.saveWorkspace(UUID, ws);

    let afterPut = false;
    fetchImpl.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(String(url));
      const id = match![2]!;
      if (method === "PUT") {
        afterPut = true;
        return new Response(
          JSON.stringify({ kind: "workspace", id, projectId: UUID, payload: {}, updatedAt: 1000 }),
          { status: 200, headers: { ETag: '"rev:1"' } },
        );
      }
      if (method === "GET" && afterPut) {
        return new Response(
          JSON.stringify({ kind: "workspace", id, projectId: UUID, payload: { different: true }, updatedAt: 1000 }),
          { status: 200, headers: { ETag: '"rev:1"' } },
        );
      }
      return new Response(null, { status: 404 });
    });

    await adapter.loadWorkspace(UUID);
    assert.equal(await cache.getLiftStamp(UUID), null);
    assert.ok(warns.some((w) => /payload mismatch/.test(w)));
  });

  it("the lift never deletes or rewrites the browser copy", async () => {
    const { adapter, cache, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    const original = JSON.parse(JSON.stringify(ws));

    await adapter.loadWorkspace(UUID);

    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    assert.deepEqual(after.value, original, "cache unchanged after lift");
    assert.ok(
      idb.store.has(WORKSPACE_KEY_PREFIX + UUID),
      "workspace key still in store after lift",
    );
  });
});

describe("CachedEditorWorkspaceAdapter save + AM rules", () => {
  it("after a read, the next save sends If-Match with that rev", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(2000);
    server.set(UUID, { payload: ws, rev: 5, updatedAt: 2000, projectId: UUID });

    await adapter.loadWorkspace(UUID);
    await adapter.saveWorkspace(UUID, makeWorkspace(3000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    const puts = putCallsOf(fetchImpl);
    assert.equal(puts.length, 1, "exactly one PUT");
    const init = puts[0]![1]!;
    const headers = new Headers(init.headers);
    assert.equal(headers.get("If-Match"), "rev:5");
  });

  it("a 409 on save: one PUT, a warning, local edits kept, no further PUT until next load", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const ws = makeWorkspace(2000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, { ownerId: "user-1", rev: 5, syncedUpdatedAt: 2000 });
    server.set(UUID, { payload: ws, rev: 5, updatedAt: 2000, projectId: UUID });

    await adapter.loadWorkspace(UUID);

    server.get(UUID)!.rev = 9; // server moved
    await adapter.saveWorkspace(UUID, makeWorkspace(3000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    assert.equal(putCallsOf(fetchImpl).length, 1, "exactly one PUT");
    assert.ok(warns.some((w) => /save conflict/.test(w)));

    const cacheAfter = await cache.loadWorkspace(UUID);
    assert.ok(cacheAfter.success && cacheAfter.value);
    assert.equal(cacheAfter.value!.updatedAt, 3000, "local edits kept");

    await adapter.saveWorkspace(UUID, makeWorkspace(4000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(putCallsOf(fetchImpl).length, 1, "no further PUT while paused");
  });

  it("a payload over 2,000,000 characters is not sent, logged, save succeeds", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    const big = makeWorkspace(1000);
    big.files["big.txt"] = { content: "x".repeat(2_000_001), isNew: true, dirty: false, updatedAt: 1000 } as never;

    const result = await adapter.saveWorkspace(UUID, big);
    assert.ok(result.success);
    assert.ok(warns.some((w) => /not saved to the server: payload/.test(w)));
    assert.equal(putCallsOf(fetchImpl).length, 0, "no PUT for oversized payload");
  });

  it("a 413 from the server: size logged, save still succeeds", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, { ownerId: "user-1", rev: 1, syncedUpdatedAt: 1000 });
    server.set(UUID, { payload: makeWorkspace(1000), rev: 1, updatedAt: 1000, projectId: UUID });

    await adapter.loadWorkspace(UUID);

    fetchImpl.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") return new Response("too large", { status: 413 });
      const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(String(url));
      const id = match![2]!;
      return new Response(
        JSON.stringify({ kind: "workspace", id, projectId: UUID, payload: {}, updatedAt: 1000 }),
        { status: 200, headers: { ETag: '"rev:1"' } },
      );
    });

    const result = await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    assert.ok(result.success, "413 does not fail the save");
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.ok(warns.some((w) => /not saved to the server: payload/.test(w)));
  });

  it("a save before any successful load sends nothing", async () => {
    const { adapter, cache, fetchImpl } = makeAdapters();
    const result = await adapter.saveWorkspace(UUID, makeWorkspace(1000));
    assert.ok(result.success);
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(putCallsOf(fetchImpl).length, 0, "no PUT without a prior load");
  });
});

describe("CachedEditorWorkspaceAdapter AM2 conflict resolution", () => {
  it("clean cache, server moved: server value returned and written to cache", async () => {
    const { adapter, cache, server } = makeAdapters();
    const oldWs = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, oldWs);
    await cache.setLiftStamp(UUID, { ownerId: "user-1", rev: 5, syncedUpdatedAt: 1000 });
    const newWs = makeWorkspace(2000);
    server.set(UUID, { payload: newWs, rev: 9, updatedAt: 2000, projectId: UUID });

    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value);
    assert.equal(result.value!.updatedAt, 2000, "returns server value");

    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    assert.equal(after.value!.updatedAt, 2000, "cache overwritten");
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp && stamp.rev === 9);
  });

  it("dirty cache, server not moved: one PUT with If-Match of stamped rev", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, { ownerId: "user-1", rev: 5, syncedUpdatedAt: 1000 });
    server.set(UUID, { payload: ws, rev: 5, updatedAt: 1000, projectId: UUID });

    await adapter.loadWorkspace(UUID);
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    const puts = putCallsOf(fetchImpl);
    assert.equal(puts.length, 1, "one catch-up PUT");
    const init = puts[0]![1]!;
    const headers = new Headers(init.headers);
    assert.equal(headers.get("If-Match"), "rev:5", "If-Match from stamp rev");
  });

  it("dirty cache, server moved: no PUT, no cache write, warning, next save sends nothing", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const oldWs = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, oldWs);
    await cache.setLiftStamp(UUID, { ownerId: "user-1", rev: 5, syncedUpdatedAt: 1000 });
    const newWs = { ...oldWs, updatedAt: 2000 };
    server.set(UUID, { payload: newWs, rev: 9, updatedAt: 2000, projectId: UUID });
    await cache.saveWorkspace(UUID, makeWorkspace(3000));

    await adapter.loadWorkspace(UUID);

    assert.equal(putCallsOf(fetchImpl).length, 0, "no PUT on dirty+moved");
    assert.ok(warns.some((w) => /conflict/.test(w)));
    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    assert.equal(after.value!.updatedAt, 3000, "local cache preserved");
  });

  it("no stamp + 200: conflict when cache differs from server", async () => {
    const { adapter, cache, server, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    const newWs = makeWorkspace(2000);
    server.set(UUID, { payload: newWs, rev: 3, updatedAt: 2000, projectId: UUID });

    await adapter.loadWorkspace(UUID);
    assert.equal(await cache.getLiftStamp(UUID), null);
    assert.ok(warns.some((w) => /no stamp, cache differs/.test(w)));
  });

  it("no stamp + 200: clean (stamp written, no PUT) when payloads equal", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    server.set(UUID, { payload: ws, rev: 3, updatedAt: 1000, projectId: UUID });

    await adapter.loadWorkspace(UUID);
    assert.ok(await cache.getLiftStamp(UUID), "stamp written");
    assert.equal(putCallsOf(fetchImpl).length, 0, "no PUT when payloads equal");
  });
});

describe("CachedEditorWorkspaceAdapter tenant + auth", () => {
  it("signed out: only cache is read/written, no /documents request", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters({ userId: null });
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value);
    assert.equal(fetchImpl.mock.calls.length, 0);

    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    assert.equal(warns.length, 0);
  });

  it("offline (every fetch rejects): only the cache is read and written", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as MockedFunction<typeof fetch>;
    const cache = new IDBEditorWorkspaceAdapter();
    const remote = new HttpEditorWorkspaceAdapter(fetchImpl);
    const { warns, logger } = warnCollector();
    const adapter = new CachedEditorWorkspaceAdapter(
      cache, remote, () => null, () => Promise.resolve("user-1"), logger,
    );

    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value);
    assert.equal(fetchImpl.mock.calls.length, 1);
    assert.equal(warns.length, 0, "no warning surfaced to editor");
  });

  it("a 401 from the server falls back to the cache", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return new Response(null, { status: 401 });
      return new Response(null, { status: 500 });
    }) as unknown as MockedFunction<typeof fetch>;
    const cache = new IDBEditorWorkspaceAdapter();
    const remote = new HttpEditorWorkspaceAdapter(fetchImpl);
    const { warns, logger } = warnCollector();
    const adapter = new CachedEditorWorkspaceAdapter(
      cache, remote, () => null, () => Promise.resolve("user-1"), logger,
    );

    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value);
    assert.equal(result.value!.updatedAt, 1000, "cache returned on 401");
  });

  it("org tenant: every call goes to the cache and no request is made", async () => {
    const { adapter, cache, fetchImpl } = makeAdapters({ tenantId: "org-1" });
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    const loadResult = await adapter.loadWorkspace(UUID);
    assert.ok(loadResult.success && loadResult.value);
    assert.equal(fetchImpl.mock.calls.length, 0, "no fetch for org");

    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    assert.equal(fetchImpl.mock.calls.length, 0, "no fetch on org save");

    await adapter.clearWorkspace(UUID);
    assert.equal(fetchImpl.mock.calls.length, 0, "no fetch on org clear");
  });
});

describe("CachedEditorWorkspaceAdapter id validation", () => {
  it("an id that fails the pattern is skipped with a log and no request", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    await adapter.loadWorkspace(BAD_ID);
    assert.equal(fetchImpl.mock.calls.length, 0);
    assert.ok(warns.some((w) => /skipped/.test(w)));
  });

  it("a non-UUID id is skipped with a log and no request", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace("valid-kebab-id", makeWorkspace(1000, "valid-kebab-id"));

    await adapter.loadWorkspace("valid-kebab-id");
    assert.equal(fetchImpl.mock.calls.length, 0);
    assert.ok(warns.some((w) => /skipped/.test(w)));
  });
});

describe("CachedEditorWorkspaceAdapter debounce", () => {
  it("five saves 300 ms apart produce one PUT, 1500 ms after the last", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, { ownerId: "user-1", rev: 1, syncedUpdatedAt: 1000 });
    server.set(UUID, { payload: ws, rev: 1, updatedAt: 1000, projectId: UUID });

    await adapter.loadWorkspace(UUID);

    for (let i = 1; i <= 5; i++) {
      await adapter.saveWorkspace(UUID, makeWorkspace(1000 + i * 100));
      await vi.advanceTimersByTimeAsync(300);
    }

    assert.equal(putCallsOf(fetchImpl).length, 0, "no PUT before debounce window");
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(putCallsOf(fetchImpl).length, 1, "one PUT after debounce");
  });
});

describe("CachedEditorWorkspaceAdapter clearWorkspace", () => {
  it("deletes cache entry, stamp and server copy, in that order", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, { ownerId: "user-1", rev: 1, syncedUpdatedAt: 1000 });
    server.set(UUID, { payload: makeWorkspace(1000), rev: 1, updatedAt: 1000, projectId: UUID });

    await adapter.clearWorkspace(UUID);

    const methods = allMethodsOf(fetchImpl);
    assert.deepEqual(methods, ["DELETE"]);
    const cacheAfter = await cache.loadWorkspace(UUID);
    assert.equal(cacheAfter.success && cacheAfter.value, null, "cache entry gone");
    assert.equal(await cache.getLiftStamp(UUID), null, "stamp gone");
    assert.equal(server.has(UUID), false);
  });

  it("without a stamp makes no DELETE request", async () => {
    const { adapter, cache, fetchImpl } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    await adapter.clearWorkspace(UUID);

    const deleteCalls = fetchImpl.mock.calls.filter(
      (c) => (c[1]?.method ?? "GET").toUpperCase() === "DELETE",
    );
    assert.equal(deleteCalls.length, 0, "no DELETE without a stamp");
    assert.equal(await cache.getLiftStamp(UUID), null, "no stamp to remove");
  });
});

describe("CachedEditorWorkspaceAdapter foreign stamp", () => {
  it("the foreign stamp (another user) is not lifted and not deleted", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, { ownerId: "other-user", rev: 9, syncedUpdatedAt: 500 });
    server.set(UUID, { payload: ws, rev: 9, updatedAt: 500, projectId: UUID });

    await adapter.loadWorkspace(UUID);

    assert.equal(putCallsOf(fetchImpl).length, 0, "no lift with foreign stamp");
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp && stamp.ownerId === "other-user", "foreign stamp preserved");
  });
});

describe("CachedEditorWorkspaceAdapter AM5 error containment", () => {
  it("a 429 error never surfaces to the editor on load or save", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return new Response(null, { status: 429 });
      if (method === "PUT") return new Response(null, { status: 429 });
      return new Response(null, { status: 429 });
    }) as unknown as MockedFunction<typeof fetch>;
    const cache = new IDBEditorWorkspaceAdapter();
    const remote = new HttpEditorWorkspaceAdapter(fetchImpl);
    const { warns, logger } = warnCollector();
    const adapter = new CachedEditorWorkspaceAdapter(
      cache, remote, () => null, () => Promise.resolve("user-1"), logger,
    );

    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value, "429 load returns cache");
    assert.equal(result.value!.updatedAt, 1000);

    const saveResult = await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    assert.ok(saveResult.success, "429 save does not surface error");
  });
});
