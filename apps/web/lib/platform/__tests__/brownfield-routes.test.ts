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
import { POST as generate } from "../../../app/api/generate/route";

const GREEN = "11111111-1111-4111-8111-111111111111";
const BROWN = "22222222-2222-4222-8222-222222222222";
const THEIRS = "33333333-3333-4333-8333-333333333333";
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
  call: (extra: Record<string, unknown>) => Promise<Response>;
  /** The collaborator that proves the route got past the guard. */
  reached: () => boolean;
}

const cases: RouteCase[] = [
  {
    name: "/api/architecture/modify/accept",
    call: (extra) =>
      accept(
        post("/api/architecture/modify/accept", {
          transactionId: "tx-1",
          ...extra,
        }),
      ),
    reached: () => downstream.execute.mock.calls.length > 0,
  },
  {
    name: "/api/push/github",
    call: (extra) =>
      push(
        post("/api/push/github", {
          githubLink: { owner: "o", repo: "r", branch: "main" },
          files: { "a.txt": "x" },
          ...extra,
        }),
      ),
    reached: () => downstream.commitFiles.mock.calls.length > 0,
  },
  {
    name: "/api/generate",
    call: (extra) =>
      generate(post("/api/generate", { manifest: { system: "s" }, ...extra })),
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
    vi.mocked(getToken).mockResolvedValue({
      sub: "owner-a",
      accessToken: "gho_test",
      login: "octocat",
    } as never);
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

      it("refuses an unknown id with 403 forbidden", async () => {
        const res = await c.call({ projectId: UNKNOWN });
        assert.equal(res.status, 403);
        assert.equal((await res.json()).error, "forbidden");
        assert.equal(c.reached(), false);
      });

      it("refuses another owner's id (even a brownfield one) with the same 403", async () => {
        const res = await c.call({ projectId: THEIRS });
        assert.equal(res.status, 403);
        assert.equal((await res.json()).error, "forbidden");
        assert.equal(c.reached(), false);
      });

      it("refuses an id from a caller with no session sub with 401", async () => {
        vi.mocked(getToken).mockResolvedValue({
          accessToken: "gho_test",
        } as never);
        const res = await c.call({ projectId: GREEN });
        assert.equal(res.status, 401);
        assert.equal(c.reached(), false);
      });

      it("refuses a non-string id with 403", async () => {
        const res = await c.call({ projectId: { $ne: null } });
        assert.equal(res.status, 403);
        assert.equal(c.reached(), false);
      });

      it("lets a stored greenfield project through to the existing behaviour", async () => {
        const res = await c.call({ projectId: GREEN });
        assert.notEqual(res.status, 409);
        assert.notEqual(res.status, 403);
        assert.equal(c.reached(), true);
      });

      it("is unchanged without an id, even with no session sub", async () => {
        vi.mocked(getToken).mockResolvedValue({
          accessToken: "gho_test",
        } as never);
        const res = await c.call({});
        assert.notEqual(res.status, 409);
        assert.notEqual(res.status, 403);
        assert.equal(c.reached(), true);
      });
    });
  }
});
