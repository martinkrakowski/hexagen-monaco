import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type {
  SavedProject,
  SavedProjectsPersistencePort,
} from "@hexagen/shared";
import {
  CachedSavedProjectsAdapter,
  HttpSavedProjectsAdapter,
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

function memoryPort(seed: SavedProject[] = []): SavedProjectsPersistencePort {
  let rows = [...seed];
  return {
    async loadProjects() {
      return { success: true, value: [...rows] };
    },
    async saveProjects(projects) {
      rows = [...projects];
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
});

describe("CachedSavedProjectsAdapter", () => {
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
});
