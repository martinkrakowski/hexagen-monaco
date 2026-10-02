import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";
import { createPlatformStore, type PlatformStore } from "../store";

// BW-D7: the three greenfield routes refuse a stored brownfield project.
// The real sqlite store (in memory) and the real guard run; only the session
// and the routes' own downstream collaborators are mocked.
let store: PlatformStore;
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("../store", async () => {
  const actual = await vi.importActual<typeof import("../store")>("../store");
  return { ...actual, getPlatformStore: () => store };
});

const downstream = vi.hoisted(() => ({
  commitFiles: vi.fn(),
  generate: vi.fn(),
  execute: vi.fn(),
  initiateExport: vi.fn(),
}));
vi.mock("@hexagen/project-generation", async (orig) => ({
  ...(await orig<typeof import("@hexagen/project-generation")>()),
  InitiateExportUseCase: class {
    initiateExport = downstream.initiateExport;
  },
}));
vi.mock("@/lib/wire.server", async () => {
  const { MonorepoRootNotFoundError } = await vi.importActual<
    typeof import("@/lib/monorepo-root")
  >("@/lib/monorepo-root");
  return {
    MonorepoRootNotFoundError,
    getRepositoryWriter: () => ({ commitFiles: downstream.commitFiles }),
    getGenerateProject: () => ({ execute: downstream.generate }),
    getTransactionManager: () => ({}),
    getManifestMutation: () => ({}),
    getLintValidation: () => ({}),
  };
});
vi.mock("@hexagen/transaction-system", () => ({
  AcceptTransactionUseCase: class {
    execute = downstream.execute;
  },
}));
vi.mock("@/lib/manifest-path", () => ({
  validateManifestPath: (p: unknown) => String(p ?? "manifest.yaml"),
}));
vi.mock("@/lib/wire.shared", () => ({
  createWebLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithException: vi.fn(),
  }),
}));
vi.mock("@/lib/request-guards", () => ({ guardMutation: () => null }));

import { getToken } from "next-auth/jwt";
import { POST as accept } from "../../../app/api/architecture/modify/accept/route";
import { POST as push } from "../../../app/api/push/github/route";
import { POST as exportGithub } from "../../../app/api/export/github/route";
import { POST as generate } from "../../../app/api/generate/route";

const GREEN = "11111111-1111-4111-8111-111111111111";
const BROWN = "22222222-2222-4222-8222-222222222222";
const THEIRS = "33333333-3333-4333-8333-333333333333";
const SHARED_GREEN = "55555555-5555-4555-8555-555555555555";
const SHARED_BROWN = "66666666-6666-4666-8666-666666666666";
const ORG_BROWN = "77777777-7777-4777-8777-777777777777";
const UNKNOWN = "44444444-4444-4444-8444-444444444444";

function project(id: string, mode?: "brownfield" | "greenfield"): SavedProject {
  return {
    id,
    name: id,
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: {},
    manifestYaml: "",
    ...(mode ? { mode } : {}),
  };
}

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface RouteCase {
  name: string;
  call: (extra: Record<string, unknown>, qs?: string) => Promise<Response>;
  /** The collaborator that proves the route got past the guard. */
  reached: () => boolean;
  /**
   * push only: its callers already send ids of IndexedDB-only or shared
   * projects, so only a RESOLVED brownfield project is refused.
   */
  lenient?: boolean;
}

const cases: RouteCase[] = [
  {
    name: "/api/architecture/modify/accept",
    call: (extra, qs = "") =>
      accept(
        post(`/api/architecture/modify/accept${qs}`, {
          transactionId: "tx-1",
          ...extra,
        }),
      ),
    reached: () => downstream.execute.mock.calls.length > 0,
  },
  {
    name: "/api/push/github",
    call: (extra, qs = "") =>
      push(
        post(`/api/push/github${qs}`, {
          githubLink: { owner: "o", repo: "r", branch: "main" },
          files: { "a.txt": "x" },
          ...extra,
        }),
      ),
    reached: () => downstream.commitFiles.mock.calls.length > 0,
    lenient: true,
  },
  {
    name: "/api/export/github",
    call: (extra, qs = "") =>
      exportGithub(
        post(`/api/export/github${qs}`, {
          owner: "me",
          repoName: "r",
          isPrivate: true,
          manifest: { system: "s" },
          ...extra,
        }),
      ),
    reached: () => downstream.initiateExport.mock.calls.length > 0,
    lenient: true,
  },
  {
    name: "/api/generate",
    call: (extra, qs = "") =>
      generate(
        post(`/api/generate${qs}`, { manifest: { system: "s" }, ...extra }),
      ),
    reached: () => downstream.generate.mock.calls.length > 0,
  },
];

describe("brownfield route guards (BW-D7)", () => {
  beforeEach(async () => {
    store = createPlatformStore(":memory:");
    const mine = store.projectsFor("owner-a");
    await mine.createProjectRecord(project(GREEN));
    await mine.createProjectRecord(project(BROWN, "brownfield"));
    await store
      .projectsFor("owner-b")
      .createProjectRecord(project(THEIRS, "brownfield"));
    // owner-b shares one greenfield and one brownfield project with owner-a.
    const theirs = store.projectsFor("owner-b");
    await theirs.createProjectRecord(project(SHARED_GREEN));
    await theirs.createProjectRecord(project(SHARED_BROWN, "brownfield"));
    for (const id of [SHARED_GREEN, SHARED_BROWN]) {
      await store.shares.grant({
        ownerId: "owner-b",
        projectId: id,
        granteeType: "user",
        granteeId: "owner-a",
        role: "write",
        grantedBy: "owner-b",
      });
    }
    // An org-owned brownfield project; owner-a is a member.
    const org = await store.orgs.createOrg({
      slug: "acme",
      name: "Acme",
      createdBy: "owner-a",
    });
    await store.orgs.addMember(org.id, "owner-a", "member");
    await store
      .projectsFor(org.id)
      .createProjectRecord(project(ORG_BROWN, "brownfield"));
    vi.mocked(getToken).mockResolvedValue({
      sub: "owner-a",
      accessToken: "gho_test",
      login: "octocat",
    } as never);
    downstream.initiateExport.mockReset().mockResolvedValue({
      success: true,
      value: { destinationUrl: "u" },
    });
    downstream.execute.mockReset().mockResolvedValue({ kind: "not-found" });
    downstream.commitFiles.mockReset().mockResolvedValue({
      success: true,
      value: { commitSha: "abc", commitUrl: "u" },
    });
    downstream.generate.mockReset().mockResolvedValue({
      success: false,
      error: { message: "stub" },
    });
  });

  for (const c of cases) {
    describe(c.name, () => {
      const noSub = () =>
        vi.mocked(getToken).mockResolvedValue({
          accessToken: "gho_test",
        } as never);

      it("refuses a stored brownfield project with 409 brownfield_mode", async () => {
        const res = await c.call({ projectId: BROWN });
        assert.equal(res.status, 409);
        assert.equal((await res.json()).error, "brownfield_mode");
        assert.equal(c.reached(), false);
      });

      it("ignores a mode sent by the client", async () => {
        const res = await c.call({ projectId: BROWN, mode: "greenfield" });
        assert.equal(res.status, 409);
        const ok = await c.call({ projectId: GREEN, mode: "brownfield" });
        assert.notEqual(ok.status, 409);
        assert.equal(c.reached(), true);
      });

      it("refuses a brownfield project shared with the caller (grantee) with 409", async () => {
        const res = await c.call({ projectId: SHARED_BROWN });
        assert.equal(res.status, 409);
        assert.equal((await res.json()).error, "brownfield_mode");
        assert.equal(c.reached(), false);
      });

      it("refuses a brownfield project owned by the caller's org with 409", async () => {
        const res = await c.call({ projectId: ORG_BROWN });
        assert.equal(res.status, 409);
        assert.equal(c.reached(), false);
      });

      it("lets a shared GREENFIELD project through (grantee unchanged)", async () => {
        const res = await c.call({ projectId: SHARED_GREEN });
        assert.notEqual(res.status, 409);
        assert.notEqual(res.status, 403);
        assert.equal(c.reached(), true);
      });

      it("lets a stored greenfield project through to the existing behaviour", async () => {
        const res = await c.call({ projectId: GREEN });
        assert.notEqual(res.status, 409);
        assert.notEqual(res.status, 403);
        assert.equal(c.reached(), true);
      });

      it("is unchanged without an id, even with no session sub", async () => {
        noSub();
        const res = await c.call({});
        assert.notEqual(res.status, 409);
        assert.notEqual(res.status, 403);
        assert.equal(c.reached(), true);
      });

      it("trims a whitespace-padded id before resolving it (409)", async () => {
        const res = await c.call({ projectId: `  ${BROWN}\n` });
        assert.equal(res.status, 409);
        assert.equal(c.reached(), false);
      });

      it("reads the BODY only: a query-string projectId is ignored", async () => {
        const res = await c.call({}, `?projectId=${BROWN}`);
        assert.notEqual(res.status, 409);
        assert.notEqual(res.status, 403);
        assert.equal(c.reached(), true);
      });

      it("a revoked grant no longer resolves the project", async () => {
        await store.shares.revoke({
          ownerId: "owner-b",
          projectId: SHARED_BROWN,
          granteeType: "user",
          granteeId: "owner-a",
        });
        const res = await c.call({ projectId: SHARED_BROWN });
        if (c.lenient) {
          assert.notEqual(res.status, 409);
          assert.notEqual(res.status, 403);
          assert.equal(c.reached(), true);
        } else {
          assert.equal(res.status, 403);
          assert.equal(c.reached(), false);
        }
      });

      it("a store that throws: strict routes 500 persistence, lenient routes proceed", async () => {
        vi.spyOn(store, "projectsFor").mockImplementation(() => {
          throw new Error("db down");
        });
        const res = await c.call({ projectId: GREEN });
        if (c.lenient) {
          assert.notEqual(res.status, 409);
          assert.equal(c.reached(), true);
        } else {
          assert.equal(res.status, 500);
          assert.equal((await res.json()).error, "persistence");
          assert.equal(c.reached(), false);
        }
      });

      if (c.lenient) {
        it("unknown id: unchanged (not refused)", async () => {
          const res = await c.call({ projectId: UNKNOWN });
          assert.notEqual(res.status, 403);
          assert.notEqual(res.status, 409);
          assert.equal(c.reached(), true);
        });

        it("another tenant's UNSHARED brownfield id is unresolvable: unchanged", async () => {
          const res = await c.call({ projectId: THEIRS });
          assert.notEqual(res.status, 403);
          assert.notEqual(res.status, 409);
          assert.equal(c.reached(), true);
        });

        it("no session sub with an id: unchanged, not 401", async () => {
          noSub();
          const res = await c.call({ projectId: BROWN });
          assert.notEqual(res.status, 401);
          assert.notEqual(res.status, 409);
          assert.equal(c.reached(), true);
        });

        it("non-string id: unchanged", async () => {
          const res = await c.call({ projectId: { $ne: null } });
          assert.notEqual(res.status, 403);
          assert.equal(c.reached(), true);
        });
      } else {
        it("refuses an unknown id with 403 forbidden", async () => {
          const res = await c.call({ projectId: UNKNOWN });
          assert.equal(res.status, 403);
          assert.equal((await res.json()).error, "forbidden");
          assert.equal(c.reached(), false);
        });

        it("refuses another tenant's unshared id (even a brownfield one) with the same 403", async () => {
          const res = await c.call({ projectId: THEIRS });
          assert.equal(res.status, 403);
          assert.equal((await res.json()).error, "forbidden");
          assert.equal(c.reached(), false);
        });

        it("refuses an id from a caller with no session sub with 401", async () => {
          noSub();
          const res = await c.call({ projectId: GREEN });
          assert.equal(res.status, 401);
          assert.equal(c.reached(), false);
        });

        it("refuses a non-string id with 403", async () => {
          const res = await c.call({ projectId: { $ne: null } });
          assert.equal(res.status, 403);
          assert.equal(c.reached(), false);
        });
      }
    });
  }
});
