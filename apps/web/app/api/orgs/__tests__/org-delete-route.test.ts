import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { DELETE as deleteOrg } from "../[orgId]/route";
import { getPlatformStore, closePlatformStore } from "../../../../lib/platform";

const ORG = "org-acme";

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

function deleteRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/orgs/${ORG}`, {
    method: "DELETE",
  });
}

const orgParams = { params: Promise.resolve({ orgId: ORG }) };

/** Seeds the org row plus one membership, and returns the live store. */
async function seedOrg(role: "owner" | "member", userId: string) {
  const store = getPlatformStore();
  await store.orgs.createOrg({
    id: ORG,
    slug: "acme",
    name: "Acme",
    createdBy: "founder",
  });
  await store.orgs.addMember(ORG, userId, role);
  return store;
}

describe("tenancy hygiene — DELETE /api/orgs/[orgId]", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("401 without a session", async () => {
    signedInAs(null);
    const res = await deleteOrg(deleteRequest(), orgParams);
    assert.equal(res.status, 401);
  });

  it("403 for an org MEMBER: deletion is owner-only — and the org survives", async () => {
    const store = await seedOrg("member", "dev-1");
    signedInAs("dev-1");
    const res = await deleteOrg(deleteRequest(), orgParams);
    assert.equal(res.status, 403);
    assert.ok(await store.orgs.getOrg(ORG), "a denied delete must not delete");
  });

  it("409 with the project count while the org owns projects", async () => {
    const store = await seedOrg("owner", "founder");
    // The org owns a project — proven present, so the 409 is the refusal
    // policy speaking and not a coincidence of empty state.
    const project: SavedProject = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "org-project",
      schemaVersion: 4,
      createdAt: 1,
      updatedAt: 1,
      formState: {},
      manifestYaml: "system: shop\nbounded_contexts: []\n",
    };
    const created = await store.projectsFor(ORG).createProjectRecord(project);
    assert.equal(created.success, true);
    signedInAs("founder");

    const res = await deleteOrg(deleteRequest(), orgParams);
    assert.equal(res.status, 409);
    const body = (await res.json()) as {
      error: string;
      projectCount: number;
    };
    assert.equal(body.error, "org_owns_projects");
    assert.equal(body.projectCount, 1);
    assert.ok(await store.orgs.getOrg(ORG), "a refused delete must not delete");
  });

  it("204 for the owner of a project-less org; second delete answers 403", async () => {
    const store = await seedOrg("owner", "founder");
    assert.ok(await store.orgs.getOrg(ORG), "org must exist before deletion");
    signedInAs("founder");

    const res = await deleteOrg(deleteRequest(), orgParams);
    assert.equal(res.status, 204);
    assert.equal(await store.orgs.getOrg(ORG), null);

    // The membership rows died with the org, so requireTenant now answers 403
    // — deliberately indistinguishable from "no such org" (D-A4 non-oracle).
    const again = await deleteOrg(deleteRequest(), orgParams);
    assert.equal(again.status, 403);
  });
});
