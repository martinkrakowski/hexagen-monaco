// P-U5: tenant threading through the saved-projects adapters.
//
// - HttpSavedProjectsAdapter derives EVERY URL from the injected tenant
//   getter: personal (null) keeps the historical /api/projects alias, an org
//   id addresses /api/tenants/<id>/projects.
// - CachedSavedProjectsAdapter goes remote-ONLY while an org is active
//   (H1.7): the IDB cache holds the personal tenant's projects, and serving
//   it as a fallback here would render the WRONG tenant's data.
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

/** Records every request; answers 200 with a plausible body. */
function recordingFetch(requests: { url: string; method: string }[]) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? "GET" });
    const method = init?.method ?? "GET";
    if (method === "GET" && !String(url).includes(sample.id)) {
      return new Response(JSON.stringify({ projects: [sample] }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify(sample), {
      status: 200,
      headers: { ETag: '"rev:7"' },
    });
  }) as unknown as typeof fetch;
}

describe("HttpSavedProjectsAdapter URL derivation (P-U5)", () => {
  it("personal tenant (null): list, item, create, update all hit /api/projects", async () => {
    const requests: { url: string; method: string }[] = [];
    const adapter = new HttpSavedProjectsAdapter(
      recordingFetch(requests),
      () => null,
    );

    await adapter.loadProjects();
    await adapter.createProjectRecord(sample);
    await adapter.updateProjectRecord(sample.id, (p) => ({
      ...p,
      name: "renamed",
    }));
    await adapter.deleteProjectRecord(sample.id);

    assert.deepEqual(
      requests.map((r) => `${r.method} ${r.url}`),
      [
        "GET /api/projects",
        "POST /api/projects",
        `GET /api/projects/${sample.id}`,
        `PUT /api/projects/${sample.id}`,
        `DELETE /api/projects/${sample.id}`,
      ],
    );
  });

  it("org tenant: the same operations hit /api/tenants/<id>/projects, id URL-encoded", async () => {
    const requests: { url: string; method: string }[] = [];
    const adapter = new HttpSavedProjectsAdapter(
      recordingFetch(requests),
      () => "org id/1",
    );

    await adapter.loadProjects();
    await adapter.createProjectRecord(sample);
    await adapter.updateProjectRecord(sample.id, (p) => ({
      ...p,
      name: "renamed",
    }));
    await adapter.deleteProjectRecord(sample.id);

    const base = "/api/tenants/org%20id%2F1/projects";
    assert.deepEqual(
      requests.map((r) => `${r.method} ${r.url}`),
      [
        `GET ${base}`,
        `POST ${base}`,
        `GET ${base}/${sample.id}`,
        `PUT ${base}/${sample.id}`,
        `DELETE ${base}/${sample.id}`,
      ],
    );
  });

  it("org tenant: update keeps the If-Match rev flow against tenant URLs", async () => {
    const headers: Array<string | null> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        headers.push(new Headers(init.headers as HeadersInit).get("If-Match"));
      }
      return new Response(JSON.stringify(sample), {
        status: 200,
        headers: { ETag: '"rev:8"' },
      });
    }) as unknown as typeof fetch;
    const adapter = new HttpSavedProjectsAdapter(fetchImpl, () => "org-1");

    await adapter.updateProjectRecord(sample.id, (p) => ({
      ...p,
      name: "first",
    }));
    await adapter.updateProjectRecord(sample.id, (p) => ({
      ...p,
      name: "second",
    }));

    // Both writes echo the rev ETag the stub advertises on every response —
    // proving the rev-token flow is intact when the URLs are tenant-scoped.
    assert.deepEqual(headers, ["rev:8", "rev:8"]);
  });

  it("org tenant: saveProjects (whole-list replace) is refused, not sent", async () => {
    const requests: { url: string; method: string }[] = [];
    const adapter = new HttpSavedProjectsAdapter(
      recordingFetch(requests),
      () => "org-1",
    );

    const result = await adapter.saveProjects([sample]);
    assert.equal(result.success, false);
    assert.equal(requests.length, 0);
  });
});

function neverCalledCache(): SavedProjectsPersistencePort {
  const refuse = async () => {
    throw new Error("IDB cache must not be touched while an org is active");
  };
  return {
    loadProjects: refuse,
    saveProjects: refuse,
    createProjectRecord: refuse,
    updateProjectRecord: refuse,
    deleteProjectRecord: refuse,
  } as unknown as SavedProjectsPersistencePort;
}

describe("CachedSavedProjectsAdapter org-tenant bypass (H1.7)", () => {
  it("org active + remote failure: the error surfaces and the cache is never read", async () => {
    const cache = neverCalledCache();
    const loadSpy = vi.spyOn(cache, "loadProjects");
    const remote: SavedProjectsPersistencePort = {
      async loadProjects() {
        return {
          success: false,
          error: { kind: "Unknown", message: "remote down" },
        };
      },
      async saveProjects() {
        return {
          success: false,
          error: { kind: "Unknown", message: "remote down" },
        };
      },
      async createProjectRecord() {
        return {
          success: false,
          error: { kind: "Unknown", message: "remote down" },
        };
      },
      async updateProjectRecord() {
        return {
          success: false,
          error: { kind: "Unknown", message: "remote down" },
        };
      },
      async deleteProjectRecord() {
        return {
          success: false,
          error: { kind: "Unknown", message: "remote down" },
        };
      },
    };
    const adapter = new CachedSavedProjectsAdapter(
      cache,
      remote,
      () => "org-1",
    );

    const loaded = await adapter.loadProjects();
    assert.equal(loaded.success, false);
    if (!loaded.success) assert.equal(loaded.error.message, "remote down");
    assert.equal(loadSpy.mock.calls.length, 0);

    // Mutations while an org is active must not fall back to the cache
    // either — not even for the unauthenticated-error fallback path.
    const created = await adapter.createProjectRecord(sample);
    assert.equal(created.success, false);
    const updated = await adapter.updateProjectRecord(sample.id, (p) => p);
    assert.equal(updated.success, false);
    const deleted = await adapter.deleteProjectRecord(sample.id);
    assert.equal(deleted.success, false);
  });

  it("org active + remote success: the result is served without writing the cache", async () => {
    const cache = neverCalledCache();
    const remote: SavedProjectsPersistencePort = {
      async loadProjects() {
        return { success: true, value: [sample] };
      },
      async saveProjects() {
        return { success: true, value: undefined };
      },
      async createProjectRecord(project) {
        return { success: true, value: project };
      },
      async updateProjectRecord() {
        return { success: true, value: sample };
      },
      async deleteProjectRecord() {
        return { success: true, value: undefined };
      },
    };
    const adapter = new CachedSavedProjectsAdapter(
      cache,
      remote,
      () => "org-1",
    );

    const loaded = await adapter.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.deepEqual(loaded.value, [sample]);
  });

  it("personal tenant: remote failure still falls back to the cache (existing behavior)", async () => {
    const cached: SavedProjectsPersistencePort = {
      async loadProjects() {
        return { success: true, value: [sample] };
      },
      async saveProjects() {
        return { success: true, value: undefined };
      },
      async createProjectRecord(project) {
        return { success: true, value: project };
      },
      async updateProjectRecord() {
        return { success: true, value: sample };
      },
      async deleteProjectRecord() {
        return { success: true, value: undefined };
      },
    };
    const remote: SavedProjectsPersistencePort = {
      async loadProjects() {
        return {
          success: false,
          error: { kind: "Unknown", message: "offline" },
        };
      },
      async saveProjects() {
        return { success: true, value: undefined };
      },
      async createProjectRecord(project) {
        return { success: true, value: project };
      },
      async updateProjectRecord() {
        return { success: true, value: sample };
      },
      async deleteProjectRecord() {
        return { success: true, value: undefined };
      },
    };
    const adapter = new CachedSavedProjectsAdapter(cached, remote, () => null);

    const loaded = await adapter.loadProjects();
    assert.equal(loaded.success, true);
    if (loaded.success) assert.deepEqual(loaded.value, [sample]);
  });
});
