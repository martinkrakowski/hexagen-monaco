import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type {
  SavedProject,
  SavedProjectsPersistencePort,
} from "@hexagen/shared";
import {
  CachedSavedProjectsAdapter,
  HttpSavedProjectsAdapter,
  UNAUTHENTICATED_SAVED_PROJECTS_MESSAGE,
} from "./http-saved-projects.adapter";

const sample: SavedProject = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "shop",
  schemaVersion: 4,
  createdAt: 1,
  updatedAt: 1,
  formState: {},
  manifestYaml: "system: shop\n",
};

function memoryPort(
  seed: SavedProject[] = [],
  options: { initialized?: boolean; ownerId?: string | null } = {},
): SavedProjectsPersistencePort & {
  isOwnerInitialized(): boolean;
  currentOwnerId(): string | null;
  getCacheOwner(): Promise<string | null>;
  setCacheOwner(ownerId: string | null): Promise<void>;
} {
  let rows = [...seed];
  let initialized = options.initialized ?? seed.length > 0;
  let ownerId = options.ownerId ?? null;
  return {
    isOwnerInitialized() {
      return initialized;
    },
    currentOwnerId() {
      return ownerId;
    },
    async getCacheOwner() {
      return ownerId;
    },
    async setCacheOwner(next) {
      ownerId = next;
    },
    async loadProjects() {
      return { success: true, value: [...rows] };
    },
    async saveProjects(projects) {
      rows = [...projects];
      initialized = true;
      return { success: true, value: undefined };
    },
    async createProjectRecord(project) {
      if (rows.some((row) => row.id === project.id)) {
        return {
          success: false,
          error: { kind: "Conflict", message: "dup" },
        };
      }
      rows = [project, ...rows];
      initialized = true;
      return { success: true, value: project };
    },
    async updateProjectRecord(id, updater) {
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) {
        return {
          success: false,
          error: { kind: "NotFound", message: "missing" },
        };
      }
      const updated = updater(rows[index]);
      rows = rows.map((row, i) => (i === index ? updated : row));
      return { success: true, value: updated };
    },
    async deleteProjectRecord(id) {
      rows = rows.filter((row) => row.id !== id);
      return { success: true, value: undefined };
    },
  };
}

describe("HttpSavedProjectsAdapter", () => {
  it("loads the server list and creates through POST", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (
        href === "/api/projects" &&
        (!init?.method || init.method === "GET")
      ) {
        return new Response(JSON.stringify({ projects: [sample] }), {
          status: 200,
        });
      }
      if (href === "/api/projects" && init?.method === "POST") {
        return new Response(JSON.stringify(sample), { status: 201 });
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;

    const port = new HttpSavedProjectsAdapter(fetchImpl);
    const loaded = await port.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.equal(loaded.value[0]?.id, sample.id);

    const created = await port.createProjectRecord(sample);
    assert.equal(created.success, true);
  });

  it("saveProjects replaces the remote list, deleting ids absent from the new array", async () => {
    const kept = sample;
    const dropped: SavedProject = {
      ...sample,
      id: "22222222-2222-4222-8222-222222222222",
      name: "gone",
    };
    const methods: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      methods.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url) === "/api/projects" && init?.method === "PUT") {
        return new Response(JSON.stringify({ projects: [kept] }), {
          status: 200,
        });
      }
      return new Response("nope", { status: 500 });
    });
    const port = new HttpSavedProjectsAdapter(fetchImpl);
    const written = await port.saveProjects([kept]);
    assert.equal(written.success, true);
    assert.deepEqual(methods, ["PUT /api/projects"]);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      projects: SavedProject[];
    };
    assert.deepEqual(
      body.projects.map((p) => p.id),
      [kept.id],
    );
    assert.ok(!body.projects.some((p) => p.id === dropped.id));
  });

  it("sends If-Match from the GET and surfaces a 409 without retrying (H1.4)", async () => {
    // Was: "retries a 409 against a fresh row". H1.4 removed that retry.
    // Re-reading and re-applying the updater is how a co-editor's change
    // disappears -- the second write wins and nobody is told. The conflict is
    // now the caller's to handle; P-A5 builds the reload-and-merge UI.
    const first = sample;
    let puts = 0;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === `/api/projects/${sample.id}` && !init?.method) {
        return new Response(JSON.stringify(first), { status: 200 });
      }
      if (href === `/api/projects/${sample.id}` && init?.method === "GET") {
        return new Response(JSON.stringify(first), { status: 200 });
      }
      if (href === `/api/projects/${sample.id}` && init?.method === "PUT") {
        puts += 1;
        const headers = new Headers(init.headers);
        assert.equal(headers.get("If-Match"), "1");
        return new Response("conflict", { status: 409 });
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    const port = new HttpSavedProjectsAdapter(fetchImpl);
    const written = await port.updateProjectRecord(sample.id, (current) => ({
      ...current,
      name: `${current.name}-patched`,
    }));
    assert.equal(written.success, false);
    if (!written.success) assert.equal(written.error.kind, "Conflict");
    // Non-vacuous: a write WAS attempted, exactly once.
    assert.equal(puts, 1);
  });

  it("adopts the GET ETag as If-Match so a GET→PUT round-trip sends rev:<n>", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === `/api/projects/${sample.id}` && !init?.method) {
        return new Response(JSON.stringify(sample), {
          status: 200,
          headers: { ETag: '"rev:4"' },
        });
      }
      if (href === `/api/projects/${sample.id}` && init?.method === "GET") {
        return new Response(JSON.stringify(sample), {
          status: 200,
          headers: { ETag: '"rev:4"' },
        });
      }
      if (href === `/api/projects/${sample.id}` && init?.method === "PUT") {
        const headers = new Headers(init.headers);
        assert.equal(headers.get("If-Match"), "rev:4");
        return new Response(
          JSON.stringify({ ...sample, name: "shop-patched" }),
          {
            status: 200,
            headers: { ETag: '"rev:5"' },
          },
        );
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    const port = new HttpSavedProjectsAdapter(fetchImpl);
    const written = await port.updateProjectRecord(sample.id, (current) => ({
      ...current,
      name: `${current.name}-patched`,
    }));
    assert.equal(written.success, true);
    if (written.success) assert.equal(written.value.name, "shop-patched");
  });

  it("retains a PUT ETag for the next write when GET still has no ETag", async () => {
    let puts = 0;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const isGet =
        href === `/api/projects/${sample.id}` &&
        (!init?.method || init.method === "GET");
      if (isGet) {
        return new Response(JSON.stringify(sample), { status: 200 });
      }
      if (href === `/api/projects/${sample.id}` && init?.method === "PUT") {
        puts += 1;
        const headers = new Headers(init.headers);
        if (puts === 1) {
          assert.equal(headers.get("If-Match"), "1");
          return new Response(JSON.stringify({ ...sample, name: "once" }), {
            status: 200,
            headers: { ETag: '"rev:2"' },
          });
        }
        assert.equal(headers.get("If-Match"), "rev:2");
        return new Response(JSON.stringify({ ...sample, name: "twice" }), {
          status: 200,
          headers: { ETag: '"rev:3"' },
        });
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    const port = new HttpSavedProjectsAdapter(fetchImpl);
    const first = await port.updateProjectRecord(sample.id, (current) => ({
      ...current,
      name: "once",
    }));
    assert.equal(first.success, true);
    const second = await port.updateProjectRecord(sample.id, (current) => ({
      ...current,
      name: "twice",
    }));
    assert.equal(second.success, true);
    assert.equal(puts, 2);
  });
});

describe("CachedSavedProjectsAdapter", () => {
  it("lifts a non-empty cache onto an empty remote instead of wiping it", async () => {
    const cache = memoryPort([sample]);
    const remote = memoryPort([]);
    const port = new CachedSavedProjectsAdapter(cache, remote);
    const loaded = await port.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.equal(loaded.value[0]?.id, sample.id);
    const remoteAfter = await remote.loadProjects();
    assert.equal(remoteAfter.success, true);
    if (remoteAfter.success) {
      assert.equal(remoteAfter.value.length, 1);
      assert.equal(remoteAfter.value[0]?.id, sample.id);
    }
    const cacheAfter = await cache.loadProjects();
    assert.equal(cacheAfter.success, true);
    if (cacheAfter.success) assert.equal(cacheAfter.value[0]?.id, sample.id);
  });

  it("does not lift cache onto an initialized empty remote", async () => {
    const cache = memoryPort([sample]);
    const remote = memoryPort([], { initialized: true });
    const port = new CachedSavedProjectsAdapter(cache, remote);
    const loaded = await port.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.deepEqual(loaded.value, []);
    const remoteAfter = await remote.loadProjects();
    assert.equal(remoteAfter.success, true);
    if (remoteAfter.success) assert.deepEqual(remoteAfter.value, []);
    const cacheAfter = await cache.loadProjects();
    assert.equal(cacheAfter.success, true);
    if (cacheAfter.success) assert.deepEqual(cacheAfter.value, []);
  });

  it("prefers the remote list and falls back to the cache", async () => {
    const cache = memoryPort([]);
    const remote = memoryPort([sample]);
    const port = new CachedSavedProjectsAdapter(cache, remote);
    const loaded = await port.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.equal(loaded.value[0]?.id, sample.id);
    const cached = await cache.loadProjects();
    assert.equal(cached.success, true);
    if (cached.success) assert.equal(cached.value[0]?.id, sample.id);

    const failingRemote: SavedProjectsPersistencePort = {
      async loadProjects() {
        return {
          success: false,
          error: { kind: "Unknown", message: "down" },
        };
      },
      saveProjects: remote.saveProjects,
      createProjectRecord: remote.createProjectRecord,
      updateProjectRecord: remote.updateProjectRecord,
      deleteProjectRecord: remote.deleteProjectRecord,
    };
    const fallback = new CachedSavedProjectsAdapter(cache, failingRemote);
    const fromCache = await fallback.loadProjects();
    assert.equal(fromCache.success, true);
    if (fromCache.success) assert.equal(fromCache.value[0]?.name, "shop");
  });

  it("does not lift a previous authenticated owner's cache onto a new empty account", async () => {
    const cache = memoryPort([sample], { ownerId: "alice" });
    const remote = memoryPort([], { ownerId: "bob" });
    const port = new CachedSavedProjectsAdapter(cache, remote);
    const loaded = await port.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.deepEqual(loaded.value, []);
    const remoteAfter = await remote.loadProjects();
    assert.equal(remoteAfter.success, true);
    if (remoteAfter.success) assert.deepEqual(remoteAfter.value, []);
    const cacheAfter = await cache.loadProjects();
    assert.equal(cacheAfter.success, true);
    if (cacheAfter.success) assert.deepEqual(cacheAfter.value, []);
    assert.equal(await cache.getCacheOwner(), "bob");
  });

  it("still lifts an unstamped (anonymous) cache onto an uninitialized remote", async () => {
    const cache = memoryPort([sample]);
    const remote = memoryPort([], { ownerId: "bob" });
    const port = new CachedSavedProjectsAdapter(cache, remote);
    const loaded = await port.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.equal(loaded.value[0]?.id, sample.id);
    const remoteAfter = await remote.loadProjects();
    assert.equal(remoteAfter.success, true);
    if (remoteAfter.success) assert.equal(remoteAfter.value[0]?.id, sample.id);
  });

  it("does not report a successful cache write when an authenticated remote update fails", async () => {
    const cache = memoryPort([sample]);
    const remote: SavedProjectsPersistencePort = {
      async loadProjects() {
        return { success: true, value: [sample] };
      },
      async saveProjects() {
        return { success: false, error: { kind: "Unknown", message: "500" } };
      },
      async createProjectRecord() {
        return { success: false, error: { kind: "Unknown", message: "500" } };
      },
      async updateProjectRecord() {
        return { success: false, error: { kind: "Unknown", message: "500" } };
      },
      async deleteProjectRecord() {
        return { success: false, error: { kind: "Unknown", message: "500" } };
      },
    };
    const port = new CachedSavedProjectsAdapter(cache, remote);
    const updated = await port.updateProjectRecord(sample.id, (current) => ({
      ...current,
      name: "renamed",
    }));
    assert.equal(updated.success, false);
    const cached = await cache.loadProjects();
    assert.equal(cached.success, true);
    if (cached.success) assert.equal(cached.value[0]?.name, "shop");
  });

  it("falls back to the cache when the remote is unauthenticated", async () => {
    const cache = memoryPort([sample]);
    const remote: SavedProjectsPersistencePort = {
      async loadProjects() {
        return {
          success: false,
          error: {
            kind: "Unknown",
            message: UNAUTHENTICATED_SAVED_PROJECTS_MESSAGE,
          },
        };
      },
      async saveProjects() {
        return {
          success: false,
          error: {
            kind: "Unknown",
            message: UNAUTHENTICATED_SAVED_PROJECTS_MESSAGE,
          },
        };
      },
      createProjectRecord: cache.createProjectRecord,
      updateProjectRecord: cache.updateProjectRecord,
      deleteProjectRecord: cache.deleteProjectRecord,
    };
    const port = new CachedSavedProjectsAdapter(cache, remote);
    const updated = await port.updateProjectRecord(sample.id, (current) => ({
      ...current,
      name: "local-only",
    }));
    assert.equal(updated.success, true);
    if (updated.success) assert.equal(updated.value.name, "local-only");
  });
});
