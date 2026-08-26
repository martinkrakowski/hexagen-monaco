// P-U5 — GET /api/tenants/[ownerId]/projects (and the personal alias, which
// now runs the same shared handler).
//
// The route this pins into existence is what makes an org-owned project
// VISIBLE: D-A8 gave the collection route a POST, so members could put
// projects into an org, but nothing could ever list them again.
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";

// Spread the real module and override only `getToken`.
vi.mock("next-auth/jwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth/jwt")>()),
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import { GET as TENANT_LIST } from "../[ownerId]/projects/route";
import { GET as ALIAS_LIST } from "../../projects/route";
import { closePlatformStore, getPlatformStore } from "../../../../lib/platform";

const ORG = "org-acme";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";
const PROJECT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function sample(id = PROJECT, name = "in-org"): SavedProject {
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

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

const tenantParams = (ownerId = ORG) => ({
  params: Promise.resolve({ ownerId }),
});

async function seedOrgWithProject() {
  const store = getPlatformStore();
  await store.orgs.createOrgWithOwner(
    { id: ORG, slug: "acme", name: "Acme", createdBy: "founder" },
    { actorId: "founder" },
  );
  await store.orgs.addMember(ORG, MEMBER, "member");
  const created = await store.projectsFor(ORG).createProjectRecord(sample());
  assert.equal(created.success, true, "fixture project must be created");
  return store;
}

describe("P-U5 — GET /api/tenants/[ownerId]/projects", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("401 without a JWT", async () => {
    await seedOrgWithProject();
    signedInAs(null);
    const res = await TENANT_LIST(
      new NextRequest(`http://localhost/api/tenants/${ORG}/projects`),
      tenantParams(),
    );
    assert.equal(res.status, 401);
  });

  it("an org member lists the org's projects, stamped with the org's ownerId", async () => {
    await seedOrgWithProject();
    signedInAs(MEMBER);
    const res = await TENANT_LIST(
      new NextRequest(`http://localhost/api/tenants/${ORG}/projects`),
      tenantParams(),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      projects: SavedProject[];
      initialized: boolean;
      ownerId: string;
    };
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0]?.id, PROJECT);
    assert.equal(body.ownerId, ORG);
  });

  it("403 for a non-member — while the org's project provably exists", async () => {
    const store = await seedOrgWithProject();
    const inOrg = await store.projectsFor(ORG).loadProjects();
    assert.equal(inOrg.success && inOrg.value.length, 1);

    signedInAs(OUTSIDER);
    const res = await TENANT_LIST(
      new NextRequest(`http://localhost/api/tenants/${ORG}/projects`),
      tenantParams(),
    );
    assert.equal(res.status, 403);
  });

  it("the personal alias still answers the caller's own list through the shared handler", async () => {
    const store = getPlatformStore();
    const created = await store
      .projectsFor(MEMBER)
      .createProjectRecord(sample(PROJECT, "personal"));
    assert.equal(created.success, true);

    signedInAs(MEMBER);
    const res = await ALIAS_LIST(
      new NextRequest("http://localhost/api/projects"),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      projects: SavedProject[];
      ownerId: string;
    };
    assert.equal(body.projects.length, 1);
    assert.equal(body.ownerId, MEMBER);
  });
});
