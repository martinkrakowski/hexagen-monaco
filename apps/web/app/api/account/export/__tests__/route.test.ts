import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { GET } from "../route";
import {
  closePlatformStore,
  DOCUMENT_KINDS,
  getPlatformStore,
  type PlatformStore,
  type RunEventRecord,
} from "../../../../../lib/platform";

const OWNER = "user-a";
const OTHER = "user-b";
const THEIR_PROJECT = "99999999-9999-4999-8999-999999999999";
/** Must match the private ceiling in `route.ts`. */
const RUN_EXPORT_LIMIT = 10_000;
/** Must match the private ceiling in `route.ts`. */
const DOCUMENT_EXPORT_LIMIT = 10_000;

function project(id: string, name: string): SavedProject {
  return {
    id,
    name,
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: {},
    manifestYaml: `system: ${name}\nbounded_contexts: []\n`,
  };
}

const telemetry = {
  stage: 3,
  label: "Port Mapping",
  durationMs: 1200,
  usedLLM: true,
  retryCount: 1,
  inputTokensEstimate: 1000,
  outputTokensActual: 400,
  servedFromCache: false,
  summary: "mapped 4 ports",
  modelName: "mercury-2",
};

function req(): NextRequest {
  return new NextRequest("http://localhost/api/account/export");
}

/**
 * Seed both tenants. Returns how many rows each genuinely holds.
 *
 * `createProjectRecord`, not `putProject`: the latter is update-only and
 * answers NotFound for a row that does not exist yet. Each create is asserted,
 * so a seeding failure surfaces here rather than as a mysteriously empty
 * bundle in the assertions below.
 */
async function seed(): Promise<{ mine: number; theirs: number }> {
  const store = getPlatformStore();
  const created = await Promise.all([
    store
      .projectsFor(OWNER)
      .createProjectRecord(
        project("11111111-1111-4111-8111-111111111111", "mine-one"),
      ),
    store
      .projectsFor(OWNER)
      .createProjectRecord(
        project("22222222-2222-4222-8222-222222222222", "mine-two"),
      ),
    store
      .projectsFor(OTHER)
      .createProjectRecord(project(THEIR_PROJECT, "theirs")),
  ]);
  for (const result of created) {
    assert.ok(result.success, `seeding failed: ${JSON.stringify(result)}`);
  }
  await store.runsFor(OWNER).record({ runId: "run-mine", telemetry });
  await store.runsFor(OTHER).record({ runId: "run-theirs", telemetry });
  return { mine: 2, theirs: 1 };
}

describe("GET /api/account/export", () => {
  beforeEach(async () => {
    await closePlatformStore();
    vi.mocked(getToken).mockResolvedValue({ sub: OWNER } as never);
  });
  afterEach(() => closePlatformStore());

  it("rejects an unauthenticated request with 401", async () => {
    vi.mocked(getToken).mockResolvedValue(null);
    const res = await GET(req());
    assert.equal(res.status, 401);
  });

  it("bundles the caller's projects, runs and entitlement", async () => {
    const counts = await seed();
    const res = await GET(req());
    assert.equal(res.status, 200);
    const body = await res.json();

    // Non-vacuity FIRST: an empty bundle must never read as a working export.
    assert.ok(
      counts.mine > 0,
      "fixture seeded no projects — the assertions below would pass over nothing",
    );
    assert.equal(body.projects.length, counts.mine);
    assert.ok(
      body.runs.events.length > 0,
      "fixture seeded no runs — a bundle with no runs cannot prove runs are exported",
    );

    assert.deepEqual(body.projects.map((p: SavedProject) => p.name).sort(), [
      "mine-one",
      "mine-two",
    ]);
    assert.equal(body.runs.events[0].runId, "run-mine");
    assert.ok(body.entitlement, "entitlement must be present");
    assert.equal(body.ownerId, OWNER);
    assert.equal(body.scope, "personal-tenant");
    assert.equal(body.runs.truncated, false);
  });

  it("contains no row belonging to another tenant", async () => {
    const counts = await seed();
    const store = getPlatformStore();

    // The other tenant's rows must EXIST, or "absent from the bundle" proves
    // nothing — it would just be an empty table.
    const theirs = await store.projectsFor(OTHER).loadProjects();
    assert.ok(theirs.success && theirs.value.length === counts.theirs);
    assert.ok((await store.runsFor(OTHER).list()).length > 0);

    const body = await (await GET(req())).json();
    const serialised = JSON.stringify(body);

    assert.equal(
      body.projects.filter((p: SavedProject) => p.name === "theirs").length,
      0,
    );
    assert.doesNotMatch(serialised, new RegExp(THEIR_PROJECT));
    assert.doesNotMatch(serialised, /run-theirs/);
  });

  it("carries no BYOK key material", async () => {
    await seed();
    const serialised = JSON.stringify(await (await GET(req())).json());
    // byok-store.ts is a SEPARATE database this route never opens, and its
    // schema has no ciphertext column at all (ADR-0030). This asserts the
    // observable consequence.
    for (const forbidden of [
      "ciphertext",
      "byok",
      "key_material",
      "apiKey",
      "encrypted",
    ]) {
      assert.doesNotMatch(
        serialised,
        new RegExp(forbidden, "i"),
        `bundle must not mention ${forbidden}`,
      );
    }
  });

  it("is served as a download and never cached", async () => {
    await seed();
    const res = await GET(req());
    assert.match(
      res.headers.get("content-disposition") ?? "",
      /^attachment; filename="hexagen-account-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  });

  it("declares the run ceiling so an archive cannot be silently partial", async () => {
    await seed();
    const body = await (await GET(req())).json();
    assert.ok(
      body.runs.limit >= 10_000,
      "the export must read far past list()'s default of 100",
    );
    assert.equal(typeof body.runs.truncated, "boolean");
  });

  it("does not flag truncated when stored runs equal the declared ceiling", async () => {
    await seed();
    const list = stubRunList(getPlatformStore(), RUN_EXPORT_LIMIT);
    const body = await (await GET(req())).json();
    assert.deepEqual(list.mock.calls[0]?.[0], {
      limit: RUN_EXPORT_LIMIT + 1,
    });
    assert.equal(body.runs.truncated, false);
    assert.equal(body.runs.events.length, RUN_EXPORT_LIMIT);
    assert.equal(body.runs.events.at(-1)?.runId, `run-${RUN_EXPORT_LIMIT - 1}`);
  });

  it("flags truncated only after probing one row past the ceiling", async () => {
    await seed();
    const list = stubRunList(getPlatformStore(), RUN_EXPORT_LIMIT + 1);
    const body = await (await GET(req())).json();
    assert.deepEqual(list.mock.calls[0]?.[0], {
      limit: RUN_EXPORT_LIMIT + 1,
    });
    assert.equal(body.runs.truncated, true);
    assert.equal(body.runs.events.length, RUN_EXPORT_LIMIT);
    assert.equal(
      body.runs.events.some(
        (event: { runId: string }) => event.runId === `run-${RUN_EXPORT_LIMIT}`,
      ),
      false,
      "the probe row must not be included in the archive",
    );
  });

  it("returns a stable 500 when project load fails, without echoing persistence details", async () => {
    const CORRUPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const store = getPlatformStore();
    const original = store.projectsFor.bind(store);
    vi.spyOn(store, "projectsFor").mockImplementation((ownerId: string) => {
      const inner = original(ownerId);
      if (ownerId !== OWNER) return inner;
      return {
        ...inner,
        loadProjects: async () => ({
          success: false as const,
          error: {
            kind: "DeserializationFailed" as const,
            message: `Saved project ${CORRUPT_ID} payload is not an object`,
          },
        }),
      };
    });
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const res = await GET(req());
    assert.equal(res.status, 500);
    const body = await res.json();
    const serialised = JSON.stringify(body);
    assert.equal(body.error, "persistence");
    assert.equal(body.message, "Unable to load projects for export");
    assert.doesNotMatch(serialised, new RegExp(CORRUPT_ID));
    assert.doesNotMatch(serialised, /payload is not an object/i);
    assert.ok(
      logged.mock.calls.some((args) =>
        args.some((arg) => typeof arg === "string" && arg.includes(CORRUPT_ID)),
      ),
      "server-side log must retain the persistence detail",
    );
    logged.mockRestore();
  });

  it("the export has one document of every kind the account authored, asserting on the set of kinds", async () => {
    const store = getPlatformStore();
    const docs = store.documentsFor(OWNER, OWNER);
    for (const kind of DOCUMENT_KINDS) {
      await docs.put({ kind, id: `own-${kind}`, payload: { kind, n: 1 } });
    }

    const body = await (await GET(req())).json();
    const kinds = body.documents.items.map((d: { kind: string }) => d.kind);
    assert.deepEqual([...kinds].sort(), [...DOCUMENT_KINDS].sort());
    for (const item of body.documents.items) {
      assert.deepEqual(item.payload, { kind: item.kind, n: 1 });
    }
  });

  it("documents authored in an org are included, with the org as ownerId", async () => {
    const store = getPlatformStore();
    const orgId = "org-documents";
    await store.orgs.createOrgWithOwner(
      {
        id: orgId,
        slug: "org-documents",
        name: "Org Documents",
        createdBy: "founder",
      },
      { actorId: "founder" },
    );
    await store.orgs.addMember(orgId, OWNER, "member");

    await store.documentsFor(orgId, OWNER).put({
      kind: "workspace",
      id: "org-doc-1",
      payload: { inOrg: true },
    });

    const body = await (await GET(req())).json();
    const orgItem = body.documents.items.find(
      (d: { ownerId: string; id: string }) => d.id === "org-doc-1",
    );
    assert.ok(orgItem, "an org-authored document must appear in the export");
    assert.equal(orgItem!.ownerId, orgId);
    assert.deepEqual(orgItem!.payload, { inOrg: true });
  });

  it("another member's org documents and another user's personal documents are not included", async () => {
    const store = getPlatformStore();
    const orgId = "org-excluded";
    await store.orgs.createOrgWithOwner(
      {
        id: orgId,
        slug: "org-excluded",
        name: "Org Excluded",
        createdBy: "founder",
      },
      { actorId: "founder" },
    );
    await store.orgs.addMember(orgId, OWNER, "member");
    await store.orgs.addMember(orgId, OTHER, "member");

    await store.documentsFor(orgId, OWNER).put({
      kind: "workspace",
      id: "mine-in-org",
      payload: {},
    });
    // Another member of the same org authored this — must stay absent.
    await store.documentsFor(orgId, OTHER).put({
      kind: "workspace",
      id: "theirs-in-org",
      payload: {},
    });
    // Another user's personal-tenant document — must stay absent.
    await store.documentsFor(OTHER, OTHER).put({
      kind: "workspace",
      id: "theirs-personal",
      payload: {},
    });

    const body = await (await GET(req())).json();
    const ids = body.documents.items.map((d: { id: string }) => d.id);
    assert.ok(
      ids.includes("mine-in-org"),
      "the caller's own org document must be present",
    );
    assert.equal(
      ids.includes("theirs-in-org"),
      false,
      "another member's org document must be absent",
    );
    assert.equal(
      ids.includes("theirs-personal"),
      false,
      "another user's personal document must be absent",
    );
  });

  it("reports the document limit and is not truncated below it, and documentsAuthoredBy honours its limit", async () => {
    const store = getPlatformStore();
    const docs = store.documentsFor(OWNER, OWNER);
    await docs.put({ kind: "workspace", id: "d1", payload: {} });
    await docs.put({ kind: "workspace", id: "d2", payload: {} });
    await docs.put({ kind: "workspace", id: "d3", payload: {} });

    const page = await store.documentsAuthoredBy(OWNER, 2);
    assert.equal(page.length, 2);

    const body = await (await GET(req())).json();
    assert.equal(body.documents.limit, DOCUMENT_EXPORT_LIMIT);
    assert.equal(body.documents.truncated, false);
  });
});

function stubRunList(store: PlatformStore, storedCount: number) {
  const original = store.runsFor.bind(store);
  const list = vi.fn((options?: { projectId?: string; limit?: number }) => {
    const limit = options?.limit ?? 100;
    const n = Math.min(storedCount, limit);
    return Promise.resolve(
      Array.from(
        { length: n },
        (_, i): RunEventRecord => ({
          id: `id-${i}`,
          runId: `run-${i}`,
          projectId: null,
          stage: 3,
          label: "Port Mapping",
          model: "mercury-2",
          refinerModel: null,
          durationMs: 1200,
          retryCount: 1,
          inputTokens: 1000,
          outputTokens: 400,
          servedFromCache: false,
          usedLlm: true,
          summary: "mapped 4 ports",
          costCents: 75,
          createdAt: 1,
        }),
      ),
    );
  });
  vi.spyOn(store, "runsFor").mockImplementation((ownerId: string) => {
    const inner = original(ownerId);
    if (ownerId !== OWNER) return inner;
    return { ...inner, list };
  });
  return list;
}
