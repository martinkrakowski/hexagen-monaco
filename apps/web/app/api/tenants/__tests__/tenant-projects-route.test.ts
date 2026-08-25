import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import {
  DELETE as TENANT_DELETE,
  GET as TENANT_GET,
  PUT as TENANT_PUT,
} from "../[ownerId]/projects/[projectId]/route";
import { GET as ALIAS_GET } from "../../projects/[projectId]/route";
import { closePlatformStore, getPlatformStore } from "../../../../lib/platform";

/**
 * P-A3 at the route boundary: the tenant-addressed shape a grantee uses.
 *
 * Every refusal here is asserted alongside proof that the project EXISTS in
 * the owner's tenant. A 403 over an empty database would pass without the
 * authorization rule ever running.
 */

const OWNER = "user-owner";
const GRANTEE = "user-grantee";
const PROJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function sample(id = PROJECT, name = "owned"): SavedProject {
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

function tenantUrl(ownerId = OWNER, projectId = PROJECT): string {
  return `http://localhost/api/tenants/${ownerId}/projects/${projectId}`;
}

function tenantParams(ownerId = OWNER, projectId = PROJECT) {
  return { params: Promise.resolve({ ownerId, projectId }) };
}

async function seedOwnedProject(): Promise<void> {
  const created = await getPlatformStore()
    .projectsFor(OWNER)
    .createProjectRecord(sample());
  assert.equal(created.success, true, "fixture project must be created");
}

/** Proves the row is really there, so a later refusal is an authz decision. */
function assertProjectExists(): void {
  const found = getPlatformStore().projectsFor(OWNER).getProject(PROJECT);
  assert.equal(found.success, true);
  if (found.success) {
    assert.ok(found.value, "the project must exist in the owner's tenant");
  }
}

describe("P-A3 — /api/tenants/[ownerId]/projects/[projectId]", () => {
  beforeEach(() => {
    closePlatformStore();
    signedInAs(OWNER);
  });
  afterEach(() => closePlatformStore());

  it("401 without a JWT", async () => {
    signedInAs(null);
    const res = await TENANT_GET(new NextRequest(tenantUrl()), tenantParams());
    assert.equal(res.status, 401);
  });

  it("the owner reads their own project through the tenant-addressed route", async () => {
    await seedOwnedProject();
    const res = await TENANT_GET(new NextRequest(tenantUrl()), tenantParams());
    assert.equal(res.status, 200);
    const body = (await res.json()) as SavedProject;
    assert.equal(body.id, PROJECT);
  });

  it("an outsider gets 403 — while the project provably exists in the owner's tenant", async () => {
    await seedOwnedProject();
    assertProjectExists();

    signedInAs(GRANTEE);
    const res = await TENANT_GET(new NextRequest(tenantUrl()), tenantParams());
    assert.equal(res.status, 403, "cross-tenant reads must be refused");
  });

  it("a read grant reads, and the payload is the OWNER's project", async () => {
    await seedOwnedProject();
    await getPlatformStore().shares.grant({
      ownerId: OWNER,
      projectId: PROJECT,
      granteeType: "user",
      granteeId: GRANTEE,
      role: "read",
      grantedBy: OWNER,
    });

    signedInAs(GRANTEE);
    const res = await TENANT_GET(new NextRequest(tenantUrl()), tenantParams());
    assert.equal(res.status, 200);
    const body = (await res.json()) as SavedProject;
    assert.equal(body.id, PROJECT);
    assert.equal(body.name, "owned");
  });

  it("a read grant may NOT write", async () => {
    await seedOwnedProject();
    await getPlatformStore().shares.grant({
      ownerId: OWNER,
      projectId: PROJECT,
      granteeType: "user",
      granteeId: GRANTEE,
      role: "read",
      grantedBy: OWNER,
    });

    signedInAs(GRANTEE);
    const res = await TENANT_PUT(
      new NextRequest(tenantUrl(), {
        method: "PUT",
        body: JSON.stringify(sample(PROJECT, "edited")),
        headers: { "content-type": "application/json" },
      }),
      tenantParams(),
    );
    assert.equal(res.status, 403, "read-only grants must not write");

    // The row must be untouched, not merely the response refused.
    const after = getPlatformStore().projectsFor(OWNER).getProject(PROJECT);
    assert.equal(after.success, true);
    if (after.success) assert.equal(after.value?.name, "owned");
  });

  it("a write grant writes, and the row changes in the OWNER's tenant", async () => {
    await seedOwnedProject();
    await getPlatformStore().shares.grant({
      ownerId: OWNER,
      projectId: PROJECT,
      granteeType: "user",
      granteeId: GRANTEE,
      role: "write",
      grantedBy: OWNER,
    });

    signedInAs(GRANTEE);
    const res = await TENANT_PUT(
      new NextRequest(tenantUrl(), {
        method: "PUT",
        body: JSON.stringify(sample(PROJECT, "edited")),
        headers: { "content-type": "application/json" },
      }),
      tenantParams(),
    );
    assert.equal(res.status, 200);

    const after = getPlatformStore().projectsFor(OWNER).getProject(PROJECT);
    assert.equal(after.success, true);
    if (after.success) assert.equal(after.value?.name, "edited");
  });

  it("a write grant may NOT create — a PUT at a missing id is 404, not insert", async () => {
    // The create-on-missing fall-through is owner-only. A write grant means
    // "edit THE shared project"; letting it mint rows would turn one grant
    // into insert-as-the-owner (review flag on #652).
    await seedOwnedProject();
    const GHOST = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await getPlatformStore().shares.grant({
      ownerId: OWNER,
      projectId: GHOST, // grant on an id that has no row
      granteeType: "user",
      granteeId: GRANTEE,
      role: "write",
      grantedBy: OWNER,
    });

    signedInAs(GRANTEE);
    const res = await TENANT_PUT(
      new NextRequest(tenantUrl(OWNER, GHOST), {
        method: "PUT",
        body: JSON.stringify(sample(GHOST, "minted")),
        headers: { "content-type": "application/json" },
      }),
      tenantParams(OWNER, GHOST),
    );
    assert.equal(res.status, 404);
    // The row must NOT exist — the 404 above alone would also pass if the
    // insert happened and something else failed.
    const after = getPlatformStore().projectsFor(OWNER).getProject(GHOST);
    assert.equal(after.success, true);
    if (after.success) assert.equal(after.value, null);
  });

  it("deleting a project revokes its live grants — no ghost grants on id reuse", async () => {
    await seedOwnedProject();
    await getPlatformStore().shares.grant({
      ownerId: OWNER,
      projectId: PROJECT,
      granteeType: "user",
      granteeId: GRANTEE,
      role: "read",
      grantedBy: OWNER,
    });

    // Non-vacuity: the grant WORKS before deletion.
    signedInAs(GRANTEE);
    const before = await TENANT_GET(
      new NextRequest(tenantUrl()),
      tenantParams(),
    );
    assert.equal(before.status, 200, "the grant must work before deletion");

    // Owner deletes, then recreates the SAME id.
    signedInAs(OWNER);
    const del = await TENANT_DELETE(
      new NextRequest(tenantUrl(), { method: "DELETE" }),
      tenantParams(),
    );
    assert.equal(del.status, 200);
    const recreate = getPlatformStore()
      .projectsFor(OWNER)
      .createProjectRecord(sample(PROJECT, "reborn"));
    assert.equal((await recreate).success, true);

    // The old grant must NOT apply to the new project.
    signedInAs(GRANTEE);
    const after = await TENANT_GET(
      new NextRequest(tenantUrl()),
      tenantParams(),
    );
    assert.equal(
      after.status,
      403,
      "a revoked-by-deletion grant must not resurrect on id reuse",
    );
  });

  it("a write grant may NOT delete — deletion is owner-only", async () => {
    await seedOwnedProject();
    await getPlatformStore().shares.grant({
      ownerId: OWNER,
      projectId: PROJECT,
      granteeType: "user",
      granteeId: GRANTEE,
      role: "write",
      grantedBy: OWNER,
    });

    signedInAs(GRANTEE);
    const res = await TENANT_DELETE(
      new NextRequest(tenantUrl(), { method: "DELETE" }),
      tenantParams(),
    );
    assert.equal(res.status, 403);

    // Non-vacuity: the project survives the refused delete.
    assertProjectExists();
  });

  it("a revoked grant is refused on the next request", async () => {
    await seedOwnedProject();
    const shares = getPlatformStore().shares;
    await shares.grant({
      ownerId: OWNER,
      projectId: PROJECT,
      granteeType: "user",
      granteeId: GRANTEE,
      role: "read",
      grantedBy: OWNER,
    });

    signedInAs(GRANTEE);
    const before = await TENANT_GET(
      new NextRequest(tenantUrl()),
      tenantParams(),
    );
    assert.equal(before.status, 200, "the grant must work before revocation");

    await shares.revoke({
      ownerId: OWNER,
      projectId: PROJECT,
      granteeType: "user",
      granteeId: GRANTEE,
    });

    const after = await TENANT_GET(
      new NextRequest(tenantUrl()),
      tenantParams(),
    );
    assert.equal(after.status, 403, "revocation applies to the next request");
  });

  it("the personal alias still serves the owner's own project (H0.4 keyed GET)", async () => {
    await seedOwnedProject();
    const res = await ALIAS_GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT}`),
      { params: Promise.resolve({ projectId: PROJECT }) },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as SavedProject;
    assert.equal(body.id, PROJECT);
  });

  it("the personal alias still 404s for a project the owner does not have", async () => {
    await seedOwnedProject();
    const missing = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const res = await ALIAS_GET(
      new NextRequest(`http://localhost/api/projects/${missing}`),
      { params: Promise.resolve({ projectId: missing }) },
    );
    assert.equal(res.status, 404);
  });
});
