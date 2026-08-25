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
import { POST as TENANT_CREATE } from "../[ownerId]/projects/route";
import { POST as ALIAS_CREATE } from "../../projects/route";
import { closePlatformStore, getPlatformStore } from "../../../../lib/platform";

/**
 * Tenant-addressed project creation (D-A8) — the packet that makes org
 * ownership reachable.
 *
 * The authorization layer already accepted an org as a project owner, but
 * `POST /api/projects` hard-coded the caller's own `sub`, so no code path
 * could ever produce an org-owned project.
 */

const ORG = "org-acme";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";
const PROJECT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

function postTo(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const tenantParams = (ownerId = ORG) => ({
  params: Promise.resolve({ ownerId }),
});

async function seedOrgWith(role: "owner" | "member", userId: string) {
  const store = getPlatformStore();
  await store.orgs.createOrgWithOwner(
    { id: ORG, slug: "acme", name: "Acme", createdBy: "founder" },
    { actorId: "founder" },
  );
  if (userId !== "founder") await store.orgs.addMember(ORG, userId, role);
  return store;
}

describe("D-A8 — POST /api/tenants/[ownerId]/projects", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("an org member creates a project OWNED BY THE ORG, not by themselves", async () => {
    const store = await seedOrgWith("member", MEMBER);
    signedInAs(MEMBER);

    const res = await TENANT_CREATE(
      postTo(`http://localhost/api/tenants/${ORG}/projects`, sample()),
      tenantParams(),
    );
    assert.equal(res.status, 201);

    // The org owns it.
    const inOrg = await store.projectsFor(ORG).loadProjects();
    assert.equal(inOrg.success, true);
    assert.equal(inOrg.success && inOrg.value.length, 1);
    assert.equal(inOrg.success && inOrg.value[0].id, PROJECT);

    // And it did NOT also land in the creator's personal tenant — that is
    // what catches a write going to both owners.
    const personal = await store.projectsFor(MEMBER).loadProjects();
    assert.equal(personal.success, true);
    assert.equal(
      personal.success && personal.value.length,
      0,
      "the creator's personal tenant must hold no copy",
    );
  });

  it("403 for a non-member — while the org provably exists", async () => {
    const store = await seedOrgWith("member", MEMBER);
    // Non-vacuity: the org is real and has a member, so the refusal below is
    // an authorization decision rather than a missing row.
    assert.ok(await store.orgs.getOrg(ORG));
    assert.equal(await store.orgs.memberRole(ORG, MEMBER), "member");

    signedInAs(OUTSIDER);
    const res = await TENANT_CREATE(
      postTo(`http://localhost/api/tenants/${ORG}/projects`, sample()),
      tenantParams(),
    );
    assert.equal(res.status, 403);

    const inOrg = await store.projectsFor(ORG).loadProjects();
    assert.equal(
      inOrg.success && inOrg.value.length,
      0,
      "a refused create must write nothing",
    );
  });

  it("401 without a session", async () => {
    await seedOrgWith("member", MEMBER);
    signedInAs(null);
    const res = await TENANT_CREATE(
      postTo(`http://localhost/api/tenants/${ORG}/projects`, sample()),
      tenantParams(),
    );
    assert.equal(res.status, 401);
  });

  it("the personal alias still creates under the caller's own tenant", async () => {
    const store = getPlatformStore();
    signedInAs(MEMBER);

    const res = await ALIAS_CREATE(
      postTo("http://localhost/api/projects", sample()),
    );
    assert.equal(res.status, 201);

    const personal = await store.projectsFor(MEMBER).loadProjects();
    assert.equal(personal.success && personal.value.length, 1);
    assert.equal(personal.success && personal.value[0].id, PROJECT);
  });
});
