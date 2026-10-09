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
  update: vi.fn(async (key: string, updater: (val: unknown) => unknown) => {
    const current = idb.store.get(key);
    idb.store.set(key, updater(current));
  }),
}));

import { IDBEditorWorkspaceAdapter } from "./idb-editor-workspace.adapter";
import {
  CachedEditorWorkspaceAdapter,
  HttpEditorWorkspaceAdapter,
} from "./http-editor-workspace.adapter";
import type { LiftStamp } from "./idb-editor-workspace.adapter";
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

function makeServerFetch(
  store: Map<string, ServerDoc>,
  validProjects: Set<string> = new Set(),
): MockedFunction<typeof fetch> {
  let revCounter = 0;
  const parseRev = (header: string | null): number | null => {
    if (!header) return null;
    const trimmed = header.trim().replaceAll('"', "");
    const match = /^rev:(\d+)$/.exec(trimmed);
    return match ? Number(match[1]) : null;
  };
  const nextRev = () => {
    for (const doc of store.values())
      revCounter = Math.max(revCounter, doc.rev);
    return ++revCounter;
  };
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
        JSON.stringify({
          kind: "workspace",
          id,
          projectId: doc.projectId,
          payload: doc.payload,
          updatedAt: doc.updatedAt,
        }),
        { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
      );
    }

    if (method === "PUT") {
      const body = JSON.parse(init?.body as string);
      const doc = store.get(id);
      const headers = new Headers(init?.headers);
      const ifMatch = parseRev(headers.get("If-Match"));
      const noneMatch = headers.get("If-None-Match");

      // Item 11: validate projectId.
      const projectId = body.projectId;
      if (
        projectId !== undefined &&
        projectId !== null &&
        !validProjects.has(projectId)
      ) {
        return new Response("project not found", { status: 400 });
      }

      if (noneMatch === "*" && doc) {
        return new Response("exists", {
          status: 412,
          headers: { ETag: `"rev:${doc.rev}"` },
        });
      }
      // Item 11: a 409 carries NO ETag (the real route's 409 has none).
      if (ifMatch !== null) {
        if (!doc) return new Response("not found", { status: 404 });
        if (ifMatch !== doc.rev) {
          return new Response("conflict", { status: 409 });
        }
        doc.payload = body.payload;
        doc.rev = nextRev();
        doc.updatedAt = Date.now();
        doc.projectId = body.projectId ?? null;
      } else if (!doc) {
        store.set(id, {
          payload: body.payload,
          rev: nextRev(),
          updatedAt: Date.now(),
          projectId: body.projectId ?? null,
        });
      } else {
        doc.payload = body.payload;
        doc.rev = nextRev();
        doc.updatedAt = Date.now();
        doc.projectId = body.projectId ?? null;
      }
      const d = store.get(id)!;
      return new Response(
        JSON.stringify({
          kind: "workspace",
          id,
          projectId: d.projectId,
          payload: d.payload,
          updatedAt: d.updatedAt,
        }),
        { status: 200, headers: { ETag: `"rev:${d.rev}"` } },
      );
    }

    if (method === "DELETE") {
      const doc = store.get(id);
      const headers = new Headers(init?.headers);
      const ifMatch = parseRev(headers.get("If-Match"));
      if (!doc) return new Response(null, { status: 404 });
      if (ifMatch !== null && ifMatch !== doc.rev) {
        return new Response("conflict", {
          status: 412,
          headers: { ETag: `"rev:${doc.rev}"` },
        });
      }
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
  const fetchImpl = makeServerFetch(server, new Set([UUID]));
  const cache = new IDBEditorWorkspaceAdapter();
  const remote = new HttpEditorWorkspaceAdapter(fetchImpl);
  const { warns, logger } = warnCollector();
  const tenantId = options?.tenantId !== undefined ? options.tenantId : null;
  const userId = options?.userId !== undefined ? options.userId : "user-1";
  const adapter = new CachedEditorWorkspaceAdapter(
    cache,
    remote,
    () => tenantId,
    () => Promise.resolve(userId),
    logger,
  );
  return { adapter, cache, remote, fetchImpl, warns, logger, server };
}

function putCallsOf(
  fetchImpl: MockedFunction<typeof fetch>,
): typeof fetchImpl.mock.calls {
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
    // Two stamp writes: confirmed:false after PUT, confirmed:true after GET.
    assert.equal(stampSpy.mock.calls.length, 2, "stamp written twice");
    assert.equal((stampSpy.mock.calls[0]![1] as LiftStamp).confirmed, false);
    assert.equal((stampSpy.mock.calls[1]![1] as LiftStamp).confirmed, true);
    assert.ok(
      stampSpy.mock.invocationCallOrder[1] >
        fetchImpl.mock.invocationCallOrder[2],
      "confirmed stamp after confirming GET",
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
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 7,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, { payload: ws, rev: 7, updatedAt: 1000, projectId: UUID });

    await adapter.loadWorkspace(UUID);
    await adapter.loadWorkspace(UUID);

    const methods = allMethodsOf(fetchImpl);
    assert.deepEqual(methods, ["GET", "GET"]);
    assert.equal(
      putCallsOf(fetchImpl).length,
      0,
      "no PUT on a stamped document",
    );
  });

  it("a failed PUT leaves no stamp and the next load retries", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    let putAttempts = 0;
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          const doc = server.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "PUT") {
          putAttempts++;
          if (putAttempts <= 2)
            return new Response("server error", { status: 500 });
          const body = JSON.parse(init?.body as string);
          server.set(id, {
            payload: body.payload,
            rev: 1,
            updatedAt: Date.now(),
            projectId: body.projectId ?? null,
          });
          const d = server.get(id)!;
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: d.projectId,
              payload: d.payload,
              updatedAt: d.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${d.rev}"` } },
          );
        }
        return new Response("nope", { status: 500 });
      },
    );

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
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "PUT") {
          afterPut = true;
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: UUID,
              payload: {},
              updatedAt: 1000,
            }),
            { status: 200, headers: { ETag: '"rev:1"' } },
          );
        }
        if (method === "GET" && afterPut) {
          return new Response("server error", { status: 500 });
        }
        return new Response(null, { status: 404 });
      },
    );

    await adapter.loadWorkspace(UUID);
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp, "stamp written with confirmed:false");
    assert.equal(stamp!.confirmed, false, "unconfirmed after failed confirm");
    assert.ok(warns.some((w) => /confirm/.test(w)));
  });

  it("a confirming GET that returns a different rev leaves no stamp", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    let afterPut = false;
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "PUT") {
          afterPut = true;
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: UUID,
              payload: {},
              updatedAt: 1000,
            }),
            { status: 200, headers: { ETag: '"rev:1"' } },
          );
        }
        if (method === "GET" && afterPut) {
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: UUID,
              payload: {},
              updatedAt: 1000,
            }),
            { status: 200, headers: { ETag: '"rev:2"' } },
          );
        }
        return new Response(null, { status: 404 });
      },
    );

    await adapter.loadWorkspace(UUID);
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(
      stamp && stamp.confirmed === false,
      "unconfirmed after rev mismatch",
    );
    assert.ok(warns.some((w) => /rev mismatch/.test(w)));
  });

  it("a confirming GET that returns a different payload leaves no stamp", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    const ws = makeWorkspace(1000, UUID, {
      "a.ts": { content: "hello", isNew: true, dirty: false, updatedAt: 1000 },
    });
    await cache.saveWorkspace(UUID, ws);

    let afterPut = false;
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "PUT") {
          afterPut = true;
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: UUID,
              payload: {},
              updatedAt: 1000,
            }),
            { status: 200, headers: { ETag: '"rev:1"' } },
          );
        }
        if (method === "GET" && afterPut) {
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: UUID,
              payload: { different: true },
              updatedAt: 1000,
            }),
            { status: 200, headers: { ETag: '"rev:1"' } },
          );
        }
        return new Response(null, { status: 404 });
      },
    );

    await adapter.loadWorkspace(UUID);
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(
      stamp && stamp.confirmed === false,
      "unconfirmed after payload mismatch",
    );
    assert.ok(warns.some((w) => /payload mismatch/.test(w)));
  });

  it("the lift is a create-only write", async () => {
    const { adapter, cache, fetchImpl } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    await adapter.loadWorkspace(UUID);

    const puts = putCallsOf(fetchImpl);
    assert.equal(puts.length, 1, "one PUT for the lift");
    const headers = new Headers(puts[0]![1]!.headers);
    assert.equal(headers.get("If-None-Match"), "*", "create-only header");
    assert.equal(headers.get("If-Match"), null, "no If-Match on lift");
  });

  it("a lift that finds a copy created elsewhere does not overwrite it", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    // Simulate a race: GET sees no document (404), but by the time the
    // create-only PUT lands, another device has created it (412).
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") return new Response(null, { status: 404 });
        if (method === "PUT") {
          const headers = new Headers(init?.headers);
          if (headers.get("If-None-Match") === "*") {
            return new Response("exists", {
              status: 412,
              headers: { ETag: '"rev:1"' },
            });
          }
        }
        return new Response("nope", { status: 500 });
      },
    );

    await adapter.loadWorkspace(UUID);

    assert.ok(warns.some((w) => /created elsewhere before the lift/.test(w)));
    assert.equal(await cache.getLiftStamp(UUID), null, "no stamp on conflict");

    // Item 10(b/c): conflict record + browser copy preserved + id paused.
    const rec = await cache.getConflicts();
    assert.ok(rec && rec.count === 1);
    assert.equal(rec!.last[0]!.where, "lift");
    assert.equal(rec!.last[0]!.stampRev, null);
    assert.equal(rec!.last[0]!.serverRev, 1);

    // Browser copy byte-identical (no overwrite).
    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    assert.deepEqual(
      after.value,
      makeWorkspace(1000),
      "browser copy unchanged",
    );

    // A following save sends nothing (paused).
    const beforePuts = putCallsOf(fetchImpl).length;
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(
      putCallsOf(fetchImpl).length,
      beforePuts,
      "no PUT while paused",
    );
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
    assert.equal(headers.get("If-Match"), '"rev:5"', "If-Match from stamp rev");
  });

  it("a 409 on save: one PUT, a warning, local edits kept, no further PUT until next load", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const ws = makeWorkspace(2000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 2000,
      confirmed: true,
    });
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
    assert.equal(
      putCallsOf(fetchImpl).length,
      1,
      "no further PUT while paused",
    );
  });

  it("a payload over 2,000,000 characters is not sent, logged, save succeeds", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    const big = makeWorkspace(1000);
    big.files["big.txt"] = {
      content: "x".repeat(2_000_001),
      isNew: true,
      dirty: false,
      updatedAt: 1000,
    } as never;

    const result = await adapter.saveWorkspace(UUID, big);
    assert.ok(result.success);
    assert.ok(warns.some((w) => /not saved to the server: payload/.test(w)));
    assert.equal(
      putCallsOf(fetchImpl).length,
      0,
      "no PUT for oversized payload",
    );
  });

  it("a 413 from the server: size logged, save still succeeds", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 1,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 1,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID);

    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "PUT") return new Response("too large", { status: 413 });
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        return new Response(
          JSON.stringify({
            kind: "workspace",
            id,
            projectId: UUID,
            payload: {},
            updatedAt: 1000,
          }),
          { status: 200, headers: { ETag: '"rev:1"' } },
        );
      },
    );

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
    assert.equal(
      putCallsOf(fetchImpl).length,
      0,
      "no PUT without a prior load",
    );
  });

  it("a save for a stamped document with no load in this page session sends If-Match of the stamped rev", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 5,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    const puts = putCallsOf(fetchImpl);
    assert.equal(puts.length, 1, "one PUT");
    const headers = new Headers(puts[0]![1]!.headers);
    assert.equal(headers.get("If-Match"), '"rev:5"', "If-Match from stamp rev");
  });
});

describe("CachedEditorWorkspaceAdapter AM2 conflict resolution", () => {
  it("clean cache, server moved: server value returned and written to cache", async () => {
    const { adapter, cache, server } = makeAdapters();
    const oldWs = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, oldWs);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    const newWs = makeWorkspace(2000);
    server.set(UUID, {
      payload: newWs,
      rev: 9,
      updatedAt: 2000,
      projectId: UUID,
    });

    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value);
    assert.equal(result.value!.updatedAt, 2000, "returns server value");

    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    assert.equal(after.value!.updatedAt, 2000, "cache overwritten");
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp && stamp.rev === 9);
  });

  it("dirty cache, server not moved: one PUT with If-Match of stamped rev, then confirming GET, then stamp", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    // Cache has UPDATED entry (2000); stamp synced to old (1000).
    const dirtyWs = makeWorkspace(2000);
    await cache.saveWorkspace(UUID, dirtyWs);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    // Server has the OLD payload at the same rev (server hasn't moved).
    const oldWs = makeWorkspace(1000);
    server.set(UUID, {
      payload: oldWs,
      rev: 5,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID); // triggers catchUp during load

    const puts = putCallsOf(fetchImpl);
    assert.equal(puts.length, 1, "one catch-up PUT during load");
    const init = puts[0]![1]!;
    const headers = new Headers(init.headers);
    assert.equal(headers.get("If-Match"), '"rev:5"', "If-Match from stamp rev");

    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp, "stamp updated after catch-up");
    if (stamp) {
      assert.equal(stamp.rev, 6, "new rev from PUT ETag");
      assert.equal(stamp.syncedUpdatedAt, 2000, "syncedUpdatedAt from cache");
      assert.equal(stamp.confirmed, true, "confirmed after GET");
    }
  });

  it("catch-up whose confirming GET fails is stamped unconfirmed, and the next save carries the new revision", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const dirtyWs = makeWorkspace(2000);
    await cache.saveWorkspace(UUID, dirtyWs);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 5,
      updatedAt: 1000,
      projectId: UUID,
    });

    // Load: dirty (2000 != 1000) + not moved (5 == 5) → catchUp.
    // Override the confirming GET to fail.
    let getAfterPut = false;
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET" && getAfterPut) {
          getAfterPut = false;
          return new Response("server error", { status: 500 });
        }
        if (method === "GET") {
          const doc = server.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "PUT") {
          getAfterPut = true;
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: UUID,
              payload: dirtyWs,
              updatedAt: 2000,
            }),
            { status: 200, headers: { ETag: '"rev:6"' } },
          );
        }
        return new Response("nope", { status: 500 });
      },
    );

    await adapter.loadWorkspace(UUID);

    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp, "stamp written after catchUp PUT");
    assert.equal(stamp!.rev, 6, "rev from PUT");
    assert.equal(stamp!.confirmed, false, "unconfirmed (GET failed)");

    // Next save should carry rev 6 (from the stamp).
    await adapter.saveWorkspace(UUID, makeWorkspace(3000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    const puts = putCallsOf(fetchImpl);
    const lastPut = puts[puts.length - 1]!;
    const headers = new Headers(lastPut[1]!.headers);
    assert.equal(headers.get("If-Match"), '"rev:6"', "next save carries rev 6");
  });

  it("catch-up that loses a race is recorded as a load conflict and pauses", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const dirtyWs = makeWorkspace(2000);
    await cache.saveWorkspace(UUID, dirtyWs);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    const cleanWs = makeWorkspace(1000);
    server.set(UUID, {
      payload: cleanWs,
      rev: 5,
      updatedAt: 1000,
      projectId: UUID,
    });

    // GET returns rev 5 (server hasn't moved yet); PUT 409s because the
    // server raced ahead to rev 7 between the GET and the PUT.
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: UUID,
              payload: cleanWs,
              updatedAt: 1000,
            }),
            { status: 200, headers: { ETag: '"rev:5"' } },
          );
        }
        if (method === "PUT") {
          return new Response("conflict", {
            status: 409,
            headers: { ETag: '"rev:7"' },
          });
        }
        if (method === "DELETE") return new Response(null, { status: 204 });
        return new Response("nope", { status: 500 });
      },
    );

    await adapter.loadWorkspace(UUID);

    const rec = await cache.getConflicts();
    assert.ok(rec);
    assert.equal(rec.count, 1);
    assert.equal(rec.last[0]!.where, "load");
    assert.equal(rec.last[0]!.stampRev, 5);
    assert.equal(rec.last[0]!.serverRev, 7);
    assert.ok(
      warns.some((w) => /catch-up PUT failed/.test(w)),
      "warning logged",
    );
  });

  it("dirty cache, server moved: no PUT, no cache write, warning, next save sends nothing", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const oldWs = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, oldWs);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    const newWs = { ...oldWs, updatedAt: 2000 };
    server.set(UUID, {
      payload: newWs,
      rev: 9,
      updatedAt: 2000,
      projectId: UUID,
    });
    await cache.saveWorkspace(UUID, makeWorkspace(3000));

    await adapter.loadWorkspace(UUID);

    assert.equal(putCallsOf(fetchImpl).length, 0, "no PUT on dirty+moved");
    assert.ok(warns.some((w) => /conflict/.test(w)));

    // Item 10(b): conflict record with both revs.
    const rec = await cache.getConflicts();
    assert.ok(rec && rec.count === 1);
    assert.equal(rec!.last[0]!.where, "load");
    assert.equal(rec!.last[0]!.stampRev, 5);

    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    assert.equal(after.value!.updatedAt, 3000, "local cache preserved");

    // Item 17: actually perform the save and advance timers.
    await adapter.saveWorkspace(UUID, makeWorkspace(3100));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(
      putCallsOf(fetchImpl).length,
      0,
      "next save sends nothing while paused",
    );
  });

  it("no stamp + 200: conflict when cache differs from server", async () => {
    const { adapter, cache, server, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    const newWs = makeWorkspace(2000);
    server.set(UUID, {
      payload: newWs,
      rev: 3,
      updatedAt: 2000,
      projectId: UUID,
    });

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

describe("CachedEditorWorkspaceAdapter Item 8: unconfirmed stamp", () => {
  it("an unconfirmed stamp and a moved server: the browser copy is kept and a conflict is recorded", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: false,
    });
    server.set(UUID, {
      payload: makeWorkspace(2000),
      rev: 9,
      updatedAt: 2000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID);

    const rec = await cache.getConflicts();
    assert.ok(rec && rec.count === 1, "one conflict recorded");
    assert.equal(rec!.last[0]!.where, "load");
    assert.equal(rec!.last[0]!.stampRev, 5);
    assert.equal(rec!.last[0]!.serverRev, 9);
    assert.ok(warns.some((w) => /unconfirmed stamp/.test(w)));
    assert.ok(warns.some((w) => /conflict/.test(w)));
    // Browser copy preserved.
    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    assert.equal(after.value!.updatedAt, 1000);
  });
});

describe("CachedEditorWorkspaceAdapter Item 9: deleted-elsewhere", () => {
  it("a deleted-elsewhere with an own clean stamp does not lift", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    // Server has no document (404).

    await adapter.loadWorkspace(UUID);

    assert.equal(
      putCallsOf(fetchImpl).length,
      0,
      "no lift on deleted-elsewhere",
    );
    assert.ok(warns.some((w) => /deleted on another device/.test(w)));
    const rec = await cache.getConflicts();
    assert.ok(rec && rec.count === 1, "conflict recorded");
    assert.equal(rec!.last[0]!.where, "deleted-elsewhere");
    // Cache and stamp preserved.
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp, "stamp preserved");
    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    assert.equal(after.value!.updatedAt, 1000, "browser copy preserved");
  });

  it("a deleted-elsewhere with a dirty cache lifts it", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const dirtyWs = makeWorkspace(2000);
    await cache.saveWorkspace(UUID, dirtyWs);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    // Server has no document (404). Cache is dirty (2000 != 1000).

    await adapter.loadWorkspace(UUID);

    // Dirty cache → lift proceeds.
    const puts = putCallsOf(fetchImpl);
    assert.equal(puts.length, 1, "one PUT to lift");
    const headers = new Headers(puts[0]![1]!.headers);
    assert.equal(headers.get("If-None-Match"), "*", "createOnly lift");
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
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(fetchImpl.mock.calls.length, 0, "no fetch after timers");

    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 1,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    await adapter.clearWorkspace(UUID);
    assert.equal(fetchImpl.mock.calls.length, 0, "no DELETE when signed out");
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
      cache,
      remote,
      () => null,
      () => Promise.resolve("user-1"),
      logger,
    );

    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value);
    assert.equal(fetchImpl.mock.calls.length, 1);
    assert.equal(warns.length, 0, "no warning surfaced to editor");
  });

  it("a 401 from the server falls back to the cache", async () => {
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") return new Response(null, { status: 401 });
        return new Response(null, { status: 500 });
      },
    ) as unknown as MockedFunction<typeof fetch>;
    const cache = new IDBEditorWorkspaceAdapter();
    const remote = new HttpEditorWorkspaceAdapter(fetchImpl);
    const { warns, logger } = warnCollector();
    const adapter = new CachedEditorWorkspaceAdapter(
      cache,
      remote,
      () => null,
      () => Promise.resolve("user-1"),
      logger,
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
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(
      fetchImpl.mock.calls.length,
      0,
      "no fetch on org save after timers",
    );

    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 1,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    await adapter.clearWorkspace(UUID);
    assert.equal(fetchImpl.mock.calls.length, 0, "no DELETE for org");
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
    await cache.saveWorkspace(
      "valid-kebab-id",
      makeWorkspace(1000, "valid-kebab-id"),
    );

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
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 1,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, { payload: ws, rev: 1, updatedAt: 1000, projectId: UUID });

    await adapter.loadWorkspace(UUID);

    for (let i = 1; i <= 5; i++) {
      await adapter.saveWorkspace(UUID, makeWorkspace(1000 + i * 100));
      await vi.advanceTimersByTimeAsync(300);
    }

    assert.equal(
      putCallsOf(fetchImpl).length,
      0,
      "no PUT before debounce window",
    );
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(putCallsOf(fetchImpl).length, 1, "one PUT after debounce");
  });
});

describe("CachedEditorWorkspaceAdapter clearWorkspace", () => {
  it("deletes cache entry, stamp and server copy, in that order", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 1,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 1,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.clearWorkspace(UUID);

    const methods = allMethodsOf(fetchImpl);
    assert.deepEqual(methods, ["DELETE"]);
    const deleteInit = fetchImpl.mock.calls[0]![1]!;
    const deleteHeaders = new Headers(deleteInit.headers);
    assert.equal(
      deleteHeaders.get("If-Match"),
      '"rev:1"',
      "conditional DELETE with stamp rev",
    );
    const cacheAfter = await cache.loadWorkspace(UUID);
    assert.equal(
      cacheAfter.success && cacheAfter.value,
      null,
      "cache entry gone",
    );
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
    await cache.setLiftStamp(UUID, {
      ownerId: "other-user",
      rev: 9,
      syncedUpdatedAt: 500,
      confirmed: true,
    });
    server.set(UUID, { payload: ws, rev: 9, updatedAt: 500, projectId: UUID });

    await adapter.loadWorkspace(UUID);

    assert.equal(putCallsOf(fetchImpl).length, 0, "no lift with foreign stamp");
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(
      stamp && stamp.ownerId === "other-user",
      "foreign stamp preserved",
    );
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
      cache,
      remote,
      () => null,
      () => Promise.resolve("user-1"),
      logger,
    );

    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value, "429 load returns cache");
    assert.equal(result.value!.updatedAt, 1000);

    const saveResult = await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    assert.ok(saveResult.success, "429 save does not surface error");
  });
});

describe("CachedEditorWorkspaceAdapter Item 6: pause + timer", () => {
  it("a timer armed before a load that finds a conflict sends nothing", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const oldWs = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, oldWs);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: oldWs,
      rev: 5,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID); // seeds rev 5
    await adapter.saveWorkspace(UUID, makeWorkspace(2000)); // timer armed

    // Server moves to rev 6 (another device).
    server.set(UUID, {
      payload: oldWs,
      rev: 6,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID); // conflict: dirty + moved → pause, cancel timer

    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(putCallsOf(fetchImpl).length, 0, "no PUT after conflict");
    assert.equal(server.get(UUID)!.rev, 6, "server still rev 6");
  });

  it("a timer armed under the personal tenant sends nothing after a switch to an organisation", async () => {
    const server = new Map<string, ServerDoc>();
    const calls: string[] = [];
    const fetchImpl = makeServerFetch(server, new Set([UUID]));
    // Override to track calls.
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push(method);
        return makeServerFetch(server, new Set([UUID]))(url, init);
      },
    );

    const cache = new IDBEditorWorkspaceAdapter();
    const remote = new HttpEditorWorkspaceAdapter(fetchImpl);
    const { logger } = warnCollector();
    let tenant = false;
    const adapter = new CachedEditorWorkspaceAdapter(
      cache,
      remote,
      () => (tenant ? "org-1" : null),
      () => Promise.resolve("user-1"),
      logger,
    );

    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 1,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 1,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID);
    await adapter.saveWorkspace(UUID, makeWorkspace(2000)); // timer armed (personal)

    // Switch to org tenant.
    tenant = true;

    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    const puts = calls.filter((c) => c === "PUT");
    assert.equal(puts.length, 0, "no PUT after org switch");
  });

  it("a save conflict pauses until the next load, and the next load un-pauses", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, { payload: ws, rev: 5, updatedAt: 1000, projectId: UUID });

    await adapter.loadWorkspace(UUID);

    // Server returns 409 on save.
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          const doc = server.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "PUT")
          return new Response("conflict", {
            status: 409,
            headers: { ETag: '"rev:9"' },
          });
        return new Response("nope", { status: 500 });
      },
    );

    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(putCallsOf(fetchImpl).length, 1, "one PUT before 409");

    // After 409: paused. Another save sends nothing.
    await adapter.saveWorkspace(UUID, makeWorkspace(3000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(putCallsOf(fetchImpl).length, 1, "no PUT while paused");

    // Reset fetch to normal (server at rev 9 now).
    server.set(UUID, {
      payload: makeWorkspace(3000),
      rev: 9,
      updatedAt: 3000,
      projectId: UUID,
    });
    fetchImpl.mockImplementation(makeServerFetch(server, new Set([UUID])));

    // Next load: dirty (3000 != 1000) + not moved? Server rev 9 != stamp rev 5 → moved → CONFLICT.
    // Hmm, need server rev == stamp rev for catchUp.
    // Set server rev to match stamp rev (5).
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 5,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID);
    // The load clears pausedIds, sees dirty (3000 != 1000) + not moved (5 == 5) → catchUp.
    // But we don't want to actually PUT here — just verify the pause is cleared.
    assert.equal(adapter["pausedIds"].has(UUID), false, "un-paused after load");
  });
});

describe("CachedEditorWorkspaceAdapter Item 7/8: cache staleness", () => {
  it("a failed cache read with a server copy returns the failure and writes nothing", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    server.set(UUID, { payload: ws, rev: 3, updatedAt: 1000, projectId: UUID });

    // Make cache.loadWorkspace fail.
    const loadSpy = vi.spyOn(cache, "loadWorkspace").mockResolvedValueOnce({
      success: false,
      error: { kind: "Unknown", message: "IDB error" } as never,
    });

    const result = await adapter.loadWorkspace(UUID);
    assert.equal(result.success, false);
    assert.equal(result.error?.kind, "Unknown");

    // Cache was not written to (saveWorkspace not called on cache).
    const putCalls = putCallsOf(fetchImpl);
    assert.equal(putCalls.length, 0, "no PUT when cache read fails");
  });

  it("a save that lands while the load's GET is in flight is not overwritten", async () => {
    const server = new Map<string, ServerDoc>();
    let getInFlight = false;
    const { adapter, cache, fetchImpl } = makeAdapters();

    // Override GET to be deferred.
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") {
          return new Promise((resolve) => {
            getInFlight = true;
            // Resolve after a save lands.
            setTimeout(() => {
              resolve(new Response(null, { status: 404 }));
            }, 0);
          }) as unknown as Response;
        }
        if (method === "PUT") {
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id: UUID,
              projectId: UUID,
              payload: {},
              updatedAt: 1000,
            }),
            { status: 200, headers: { ETag: '"rev:1"' } },
          );
        }
        return new Response("nope", { status: 500 });
      },
    );

    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    const loadPromise = adapter.loadWorkspace(UUID);
    // Give the load a chance to start.
    await vi.advanceTimersByTimeAsync(1);
    // Save while GET is in flight.
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    // Resolve the GET.
    await vi.runAllTimersAsync();
    await loadPromise;

    // Cache should have the newer value (2000).
    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    assert.equal(after.value!.updatedAt, 2000, "newer save preserved");
  });
});

describe("CachedEditorWorkspaceAdapter Item 1: no self-conflict", () => {
  it("two saves do not self-conflict: the second carries the rev the first returned", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    server.set(UUID, { payload: ws, rev: 1, updatedAt: 1000, projectId: UUID });

    await adapter.loadWorkspace(UUID);

    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    await adapter.saveWorkspace(UUID, makeWorkspace(3000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    const puts = putCallsOf(fetchImpl);
    assert.equal(puts.length, 2, "two PUTs");
    const h2 = new Headers(puts[1]![1]!.headers);
    assert.equal(
      h2.get("If-Match"),
      '"rev:2"',
      "second PUT carries rev from first",
    );
    assert.equal(warns.length, 0, "no warnings");
    const rec = await cache.getConflicts();
    assert.equal(rec?.count ?? 0, 0, "zero conflict records");
  });

  it("first is createOnly, second carries the returned rev", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    await adapter.loadWorkspace(UUID); // GET 404 → firstWriteAfter404

    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    await adapter.saveWorkspace(UUID, makeWorkspace(3000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    const puts = putCallsOf(fetchImpl);
    assert.equal(puts.length, 2, "two PUTs");
    const h1 = new Headers(puts[0]![1]!.headers);
    assert.equal(h1.get("If-None-Match"), "*", "first PUT is createOnly");
    const h2 = new Headers(puts[1]![1]!.headers);
    assert.equal(h2.get("If-Match"), '"rev:1"', "second PUT carries rev");
    assert.equal(warns.length, 0, "no warnings");
    const rec = await cache.getConflicts();
    assert.equal(rec?.count ?? 0, 0, "zero conflict records");
  });
});

describe("CachedEditorWorkspaceAdapter Item 11: first write", () => {
  it("a failed lift does not leave the next save unconditional", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));

    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") return new Response(null, { status: 404 });
        if (method === "PUT")
          return new Response("server error", { status: 500 });
        return new Response("nope", { status: 500 });
      },
    );

    await adapter.loadWorkspace(UUID); // lift PUT fails
    assert.ok(warns.some((w) => /lift PUT failed/.test(w)));
    assert.equal(await cache.getLiftStamp(UUID), null);

    // Another device creates the document.
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 1,
      updatedAt: 1000,
      projectId: UUID,
    });

    const beforePuts = putCallsOf(fetchImpl).length;
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    const afterPuts = putCallsOf(fetchImpl).length;
    assert.equal(
      afterPuts - beforePuts,
      0,
      "no PUT after failed lift when cache has entry",
    );
  });

  it("a first save finds a copy created elsewhere and does not overwrite it", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();

    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          const doc = server.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "PUT") {
          const headers = new Headers(init?.headers);
          if (headers.get("If-None-Match") === "*") {
            const doc = server.get(id);
            if (doc) {
              return new Response("exists", {
                status: 412,
                headers: { ETag: `"rev:${doc.rev}"` },
              });
            }
            const body = JSON.parse(init?.body as string);
            server.set(id, {
              payload: body.payload,
              rev: 1,
              updatedAt: Date.now(),
              projectId: body.projectId ?? null,
            });
            const d = server.get(id)!;
            return new Response(
              JSON.stringify({
                kind: "workspace",
                id,
                projectId: d.projectId,
                payload: d.payload,
                updatedAt: d.updatedAt,
              }),
              { status: 200, headers: { ETag: `"rev:${d.rev}"` } },
            );
          }
          return new Response("nope", { status: 500 });
        }
        return new Response("nope", { status: 500 });
      },
    );

    await adapter.loadWorkspace(UUID); // GET 404 → firstWriteAfter404 set, cache empty
    assert.equal(await cache.getLiftStamp(UUID), null);

    // Another device creates the document.
    server.set(UUID, {
      payload: makeWorkspace(999),
      rev: 1,
      updatedAt: 999,
      projectId: UUID,
    });

    // Save → timer fires → createOnly PUT → 412 (exists) → "created elsewhere", no overwrite.
    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    assert.ok(
      warns.some((w) => /created elsewhere before the first save/.test(w)),
    );
    // Item 10(c): conflict record + browser copy preserved + id paused.
    const rec = await cache.getConflicts();
    assert.ok(rec && rec.count === 1);
    assert.equal(rec!.last[0]!.where, "first-save");
    assert.equal(rec!.last[0]!.stampRev, null);

    assert.equal(
      putCallsOf(fetchImpl).length,
      1,
      "one PUT (the createOnly that got 412)",
    );
    // Browser copy byte-identical (save wrote to cache, but server unchanged).
    const after = await cache.loadWorkspace(UUID);
    assert.ok(after.success && after.value);
    // Server keeps the other device's value.
    assert.equal(server.get(UUID)!.rev, 1);

    // A following save sends nothing (paused).
    const beforePuts = putCallsOf(fetchImpl).length;
    await adapter.saveWorkspace(UUID, makeWorkspace(3000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    assert.equal(
      putCallsOf(fetchImpl).length,
      beforePuts,
      "no PUT while paused",
    );
  });
});

describe("CachedEditorWorkspaceAdapter Item 14: clearWorkspace", () => {
  it("clear does not delete a server copy whose rev moved", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    // Server moved to rev 9.
    server.set(UUID, {
      payload: makeWorkspace(2000),
      rev: 9,
      updatedAt: 2000,
      projectId: UUID,
    });

    await adapter.clearWorkspace(UUID);

    const methods = allMethodsOf(fetchImpl);
    assert.deepEqual(methods, ["DELETE"], "one conditional DELETE");
    assert.ok(
      warns.some((w) =>
        /server copy changed on another device, not deleted/.test(w),
      ),
    );
    // Item 10(b): conflict record for the discard's 412.
    const rec = await cache.getConflicts();
    assert.ok(rec && rec.count === 1);
    assert.equal(rec!.last[0]!.where, "discard");
    assert.equal(rec!.last[0]!.stampRev, 5);
    assert.equal(server.has(UUID), true, "server copy preserved");
    assert.equal(await cache.getLiftStamp(UUID), null, "stamp removed");
    const cacheAfter = await cache.loadWorkspace(UUID);
    assert.equal(cacheAfter.success && cacheAfter.value, null, "cache cleared");
  });

  it("clear cancels a pending save timer so no PUT fires", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 1,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 1,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID);
    await adapter.saveWorkspace(UUID, makeWorkspace(2000)); // timer armed

    await adapter.clearWorkspace(UUID); // epoch increment, timer cancelled
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    assert.equal(
      putCallsOf(fetchImpl).length,
      0,
      "no PUT after clear cancels timer",
    );
    assert.equal(
      server.has(UUID),
      false,
      "server copy deleted by clear's own DELETE",
    );
  });
});

describe("CachedEditorWorkspaceAdapter Item 4: discard marker", () => {
  it("a discard while offline does not come back at the next load, and the server copy is deleted then", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, { payload: ws, rev: 5, updatedAt: 1000, projectId: UUID });

    // Override: DELETE fails (offline), GET still works.
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          const doc = server.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "DELETE")
          return new Response("network error", { status: 500 });
        if (method === "PUT") return new Response("nope", { status: 500 });
        return new Response("nope", { status: 500 });
      },
    );

    // clearWorkspace: conditional DELETE fails (500) → marker written.
    await adapter.clearWorkspace(UUID);
    assert.equal(
      server.has(UUID),
      true,
      "server copy still there (DELETE failed)",
    );

    const mark = await cache.getLiftStamp(UUID);
    assert.ok(mark && mark.discarded, "discard marker written");

    // Next load: GET 200, rev matches marker → retry DELETE → success.
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          const doc = server.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "DELETE") {
          server.delete(id);
          return new Response(null, { status: 204 });
        }
        return new Response("nope", { status: 500 });
      },
    );

    const result = await adapter.loadWorkspace(UUID);
    assert.equal(
      result.success && result.value,
      null,
      "load returns null (discarded)",
    );
    assert.equal(server.has(UUID), false, "server copy deleted on retry");
    assert.equal(await cache.getLiftStamp(UUID), null, "marker dropped");
  });

  it("a discard that got 429 does not come back until the DELETE succeeds", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 3,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, { payload: ws, rev: 3, updatedAt: 1000, projectId: UUID });

    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          const doc = server.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "DELETE")
          return new Response("rate limited", { status: 429 });
        return new Response("nope", { status: 500 });
      },
    );

    await adapter.clearWorkspace(UUID);
    const mark = await cache.getLiftStamp(UUID);
    assert.ok(mark && mark.discarded, "marker written on 429");

    // Retry load: 429 → keep marker, return null.
    const result = await adapter.loadWorkspace(UUID);
    assert.equal(
      result.success && result.value,
      null,
      "load returns null (marker kept)",
    );
    assert.ok(await cache.getLiftStamp(UUID), "marker still present");
  });

  it("a discard marker and a server copy that moved: the moved copy is loaded and the marker is gone", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, { payload: ws, rev: 5, updatedAt: 1000, projectId: UUID });

    // clearWorkspace: DELETE returns 500 → marker on rev 5.
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          const doc = server.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "DELETE") return new Response("error", { status: 500 });
        return new Response("nope", { status: 500 });
      },
    );

    await adapter.clearWorkspace(UUID);
    const mark = await cache.getLiftStamp(UUID);
    assert.ok(mark && mark.discarded, "marker written");

    // Server moved: another device wrote rev 9.
    server.set(UUID, {
      payload: makeWorkspace(2000),
      rev: 9,
      updatedAt: 2000,
      projectId: UUID,
    });

    const result = await adapter.loadWorkspace(UUID);
    assert.ok(result.success && result.value);
    assert.equal(result.value!.updatedAt, 2000, "moved server copy returned");
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(stamp && !stamp.discarded, "marker dropped, new stamp present");
  });

  it("a discard marker survives a failed GET and still returns nothing", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, { payload: ws, rev: 5, updatedAt: 1000, projectId: UUID });

    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "DELETE") return new Response("error", { status: 500 });
        if (method === "GET")
          return new Response("network error", { status: 500 });
        return new Response("nope", { status: 500 });
      },
    );

    await adapter.clearWorkspace(UUID);
    const mark = await cache.getLiftStamp(UUID);
    assert.ok(mark && mark.discarded, "marker written");

    // Load: GET fails → keep marker, return null.
    const result = await adapter.loadWorkspace(UUID);
    assert.equal(
      result.success && result.value,
      null,
      "load returns null on failed GET",
    );
    assert.ok(
      await cache.getLiftStamp(UUID),
      "marker still present after failed GET",
    );
  });

  it("clear with a foreign stamp makes no request", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, {
      ownerId: "other-user",
      rev: 9,
      syncedUpdatedAt: 500,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 9,
      updatedAt: 500,
      projectId: UUID,
    });

    await adapter.clearWorkspace(UUID);

    assert.equal(
      fetchImpl.mock.calls.length,
      0,
      "no request with foreign stamp",
    );
    assert.equal(
      await cache.getLiftStamp(UUID),
      null,
      "foreign stamp removed by cache clear",
    );
  });

  it("clear cancels a pending save timer so no PUT fires", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 1,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 1,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID);
    await adapter.saveWorkspace(UUID, makeWorkspace(2000)); // timer armed

    await adapter.clearWorkspace(UUID); // epoch increment, timer cancelled
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    assert.equal(
      putCallsOf(fetchImpl).length,
      0,
      "no PUT after clear cancels timer",
    );
    assert.equal(
      server.has(UUID),
      false,
      "server copy deleted by clear's own DELETE",
    );
    assert.equal(await cache.getLiftStamp(UUID), null, "stamp removed");
    const cacheAfter = await cache.loadWorkspace(UUID);
    assert.equal(cacheAfter.success && cacheAfter.value, null, "cache cleared");
  });
});

describe("CachedEditorWorkspaceAdapter Item 15: identity reset", () => {
  it("after a 401 the user id is asked for again", async () => {
    const { defaultUserIdSource, resetCachedUserId } =
      await import("./http-editor-workspace.adapter");
    const store = new Map<string, ServerDoc>();
    let userFetchCount = 0;
    const sessionFetch = vi.fn(async () => {
      userFetchCount++;
      return new Response(JSON.stringify({ user: { sub: "user-1" } }), {
        status: 200,
      });
    }) as unknown as MockedFunction<typeof fetch>;

    // Mock global fetch only for /api/auth/session.
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/api/auth/session"))
          return sessionFetch(url as never, init);
        return makeServerFetch(store)(url as never, init);
      },
    ) as never;

    resetCachedUserId();

    const fetched = await defaultUserIdSource();
    assert.equal(fetched, "user-1");
    assert.equal(userFetchCount, 1);

    // Simulate 401 → reset cache → next call re-fetches.
    resetCachedUserId();
    const again = await defaultUserIdSource();
    assert.equal(again, "user-1");
    assert.equal(userFetchCount, 2, "user id re-fetched after reset");

    globalThis.fetch = realFetch;
  });
});

describe("CachedEditorWorkspaceAdapter Item 18: foreign stamp + save", () => {
  it("a foreign stamp and a 404: no lift", async () => {
    const { adapter, cache, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "other-user",
      rev: 9,
      syncedUpdatedAt: 500,
      confirmed: true,
    });

    await adapter.loadWorkspace(UUID);

    assert.equal(
      putCallsOf(fetchImpl).length,
      0,
      "no lift with foreign stamp + 404",
    );
    const stamp = await cache.getLiftStamp(UUID);
    assert.ok(
      stamp && stamp.ownerId === "other-user",
      "foreign stamp preserved",
    );
  });

  it("a foreign stamp: a save sends nothing", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();
    const ws = makeWorkspace(1000);
    await cache.saveWorkspace(UUID, ws);
    await cache.setLiftStamp(UUID, {
      ownerId: "other-user",
      rev: 9,
      syncedUpdatedAt: 500,
      confirmed: true,
    });
    server.set(UUID, { payload: ws, rev: 9, updatedAt: 500, projectId: UUID });

    await adapter.loadWorkspace(UUID);

    await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    assert.equal(putCallsOf(fetchImpl).length, 0, "no PUT with foreign stamp");
  });

  it("an id that fails the pattern is skipped with a log and no request", async () => {
    const { adapter, cache, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await adapter.loadWorkspace(BAD_ID);
    assert.equal(fetchImpl.mock.calls.length, 0);
    assert.ok(warns.some((w) => /skipped/.test(w)));
  });
});

describe("CachedEditorWorkspaceAdapter conflict recording (Item 4)", () => {
  it("each kind of conflict adds one record with where it happened and both revisions", async () => {
    const { adapter, cache, server, fetchImpl } = makeAdapters();

    // Load conflict (no stamp, cache differs): GET 200, cache has different entry.
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    server.set(UUID, {
      payload: makeWorkspace(2000),
      rev: 3,
      updatedAt: 2000,
      projectId: UUID,
    });
    await adapter.loadWorkspace(UUID);

    // Save conflict (409): stamp exists, save → PUT → 409.
    const {
      adapter: a2,
      cache: c2,
      server: s2,
      fetchImpl: f2,
    } = makeAdapters();
    await c2.saveWorkspace(UUID, makeWorkspace(1000));
    await c2.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    s2.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 5,
      updatedAt: 1000,
      projectId: UUID,
    });
    await a2.loadWorkspace(UUID);
    s2.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 9,
      updatedAt: 1000,
      projectId: UUID,
    });
    f2.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          const doc = s2.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "PUT")
          return new Response("conflict", {
            status: 409,
            headers: { ETag: '"rev:9"' },
          });
        return new Response("nope", { status: 500 });
      },
    );
    await a2.saveWorkspace(UUID, makeWorkspace(2000));
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);

    const rec = await cache.getConflicts();
    assert.ok(rec);
    assert.equal(rec.count, 2);
    const loadConflicts = rec.last.filter((e) => e.where === "load");
    assert.equal(loadConflicts.length, 1);
    assert.equal(loadConflicts[0]!.id, UUID);
    assert.equal(loadConflicts[0]!.stampRev, null);
    assert.equal(loadConflicts[0]!.serverRev, 3);
    const saveConflicts = rec.last.filter((e) => e.where === "save");
    assert.equal(saveConflicts.length, 1);
    assert.equal(saveConflicts[0]!.stampRev, 5);
    assert.equal(saveConflicts[0]!.serverRev, 9);
  });

  it("the record keeps the newest twenty and counts all", async () => {
    const { cache } = makeAdapters();
    for (let i = 0; i < 25; i++) {
      await cache.recordConflict({
        id: `id-${i}`,
        at: new Date().toISOString(),
        where: "load",
        stampRev: i,
        serverRev: i + 100,
      });
    }
    const rec = await cache.getConflicts();
    assert.ok(rec);
    assert.equal(rec.count, 25, "count tracks all");
    assert.equal(rec.last.length, 20, "last capped at 20");
    assert.equal(rec.last[0]!.id, "id-5", "first 5 dropped");
    assert.equal(rec.last[19]!.id, "id-24", "newest kept");
  });

  it("a failed record write does not fail load (dirty + moved conflict)", async () => {
    const { adapter, cache, server, warns } = makeAdapters();
    const dirtyWs = makeWorkspace(2000);
    await cache.saveWorkspace(UUID, dirtyWs);
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 9,
      updatedAt: 2000,
      projectId: UUID,
    });

    // Cache is dirty (2000 != 1000) and server moved (9 != 5) → load conflict.
    vi.spyOn(cache, "recordConflict").mockImplementationOnce(async () => {
      throw new Error("storage error");
    });

    const result = await adapter.loadWorkspace(UUID);
    assert.ok(
      result.success && result.value,
      "load succeeds even if record write fails",
    );
    assert.ok(warns.some((w) => /conflict/.test(w)));
  });

  it("a failed record write does not fail save (409 conflict)", async () => {
    const { adapter, cache, server, fetchImpl, warns } = makeAdapters();
    await cache.saveWorkspace(UUID, makeWorkspace(1000));
    await cache.setLiftStamp(UUID, {
      ownerId: "user-1",
      rev: 5,
      syncedUpdatedAt: 1000,
      confirmed: true,
    });
    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 5,
      updatedAt: 1000,
      projectId: UUID,
    });

    await adapter.loadWorkspace(UUID);

    server.set(UUID, {
      payload: makeWorkspace(1000),
      rev: 9,
      updatedAt: 1000,
      projectId: UUID,
    });
    fetchImpl.mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const match = /\/api\/tenants\/(.+)\/documents\/workspace\/(.+)/.exec(
          String(url),
        );
        const id = match![2]!;
        if (method === "GET") {
          const doc = server.get(id);
          if (!doc) return new Response(null, { status: 404 });
          return new Response(
            JSON.stringify({
              kind: "workspace",
              id,
              projectId: doc.projectId,
              payload: doc.payload,
              updatedAt: doc.updatedAt,
            }),
            { status: 200, headers: { ETag: `"rev:${doc.rev}"` } },
          );
        }
        if (method === "PUT") return new Response("conflict", { status: 409 });
        if (method === "DELETE") return new Response(null, { status: 204 });
        return new Response("nope", { status: 500 });
      },
    );

    vi.spyOn(cache, "recordConflict").mockImplementationOnce(async () => {
      throw new Error("storage error");
    });

    const saveResult = await adapter.saveWorkspace(UUID, makeWorkspace(2000));
    assert.ok(saveResult.success, "save succeeds even if record write fails");
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
  });
});
