// @vitest-environment node
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";
import type { Backend } from "../../../test-support/platform-backends";
import {
  resolveProjectAccess,
  type ProjectAccessReaders,
} from "../require-owner";
import type { SavedProject } from "@hexagen/shared";

function defined<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error("expected " + what);
  return v;
}

function must<T>(
  r: { success: true; value: T } | { success: false; error: unknown },
): T {
  if (!r.success)
    throw new Error(`expected success, got ${JSON.stringify(r.error)}`);
  return r.value;
}

const OWNER = "user-owner";
const OUTSIDER = "user-outsider";
const PROJECT = "11111111-1111-4111-8111-111111111111";

function project(id: string): SavedProject {
  const now = Date.now();
  return {
    id,
    name: "Owner's project",
    createdAt: now,
    updatedAt: now,
  } as SavedProject;
}

function buildReaders(backend: Backend): ProjectAccessReaders {
  return {
    memberRole: (orgId, userId) => backend.store.orgs.memberRole(orgId, userId),
    listOrgIdsForUser: (userId) => backend.store.orgs.listOrgIdsForUser(userId),
    listTeamIdsForUser: (userId) =>
      backend.store.teams.listTeamIdsForUser(userId),
    accessFor: (ownerId, projectId, identity) =>
      backend.store.shares.accessFor(ownerId, projectId, identity),
  };
}

async function seedProject(backend: Backend, ownerId: string): Promise<void> {
  must(
    await backend.store
      .projectsFor(ownerId)
      .createProjectRecord(project(PROJECT)),
  );
}

const req = () =>
  new NextRequest(`http://localhost/api/tenants/${OWNER}/projects/${PROJECT}`);

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

/**
 * P-A3 — who may reach a project, and as what.
 *
 * The headline case is the cross-tenant read: a signed-in user who is NOT the
 * owner and holds no grant must be refused, AND the project must be proven to
 * exist in the owner's tenant. Without that second assertion the test passes
 * over an empty database, which would make it agree with a broken
 * implementation.
 */
describe.each(BACKENDS)("P-A3 — resolveProjectAccess (%s", (kind) => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset();
  });

  it("401 without a JWT sub", async () => {
    const backend = await openBackend(kind);
    try {
      signedInAs(null);
      const r = await resolveProjectAccess(
        req(),
        OWNER,
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.response.status, 401);
    } finally {
      await backend.close();
    }
  });

  it("the owner of their own tenant gets role owner", async () => {
    const backend = await openBackend(kind);
    try {
      await seedProject(backend, OWNER);
      signedInAs(OWNER);
      const r = await resolveProjectAccess(
        req(),
        OWNER,
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.role, "owner");
        assert.equal(r.ownerId, OWNER);
        assert.equal(r.actorUserId, OWNER);
      }
    } finally {
      await backend.close();
    }
  });

  it("cross-tenant read is 403 — and the project DOES exist in the owner's tenant", async () => {
    const backend = await openBackend(kind);
    try {
      await seedProject(backend, OWNER);
      // The outsider is a real, signed-in user with an org of their own, so
      // the refusal cannot be "this user has no identity".
      const orgs = backend.store.orgs;
      await orgs.createOrg({
        id: "org-b",
        slug: "org-b",
        name: "Org B",
        createdBy: OUTSIDER,
      });
      await orgs.addMember("org-b", OUTSIDER, "owner");

      // Non-vacuity: prove the row is there before asserting the refusal, so
      // the 403 is an authorization decision and not a 404 in disguise.
      const owned = must(
        await backend.store.projectsFor(OWNER).getProject(PROJECT),
      );
      assert.ok(owned, "the project must exist in the owner's tenant");
      assert.equal(defined(owned, "project").id, PROJECT);

      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(
        req(),
        OWNER,
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(r.ok, false, "an outsider must not reach another tenant");
      if (!r.ok) assert.equal(r.response.status, 403);
    } finally {
      await backend.close();
    }
  });

  it("a direct user grant resolves to its role", async () => {
    const backend = await openBackend(kind);
    try {
      await seedProject(backend, OWNER);
      await backend.store.shares.grant({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "user",
        granteeId: OUTSIDER,
        role: "read",
        grantedBy: OWNER,
      });
      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(
        req(),
        OWNER,
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.role, "read");
        assert.equal(r.ownerId, OWNER, "the store is built for the REAL owner");
        assert.equal(r.actorUserId, OUTSIDER);
      }
    } finally {
      await backend.close();
    }
  });

  it("a grant to one of the caller's ORGS resolves", async () => {
    const backend = await openBackend(kind);
    try {
      await seedProject(backend, OWNER);
      const orgs = backend.store.orgs;
      await orgs.createOrg({
        id: "org-b",
        slug: "org-b",
        name: "Org B",
        createdBy: OUTSIDER,
      });
      await orgs.addMember("org-b", OUTSIDER, "member");
      await backend.store.shares.grant({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "org",
        granteeId: "org-b",
        role: "write",
        grantedBy: OWNER,
      });
      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(
        req(),
        OWNER,
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.role, "write");
    } finally {
      await backend.close();
    }
  });

  it("a grant to one of the caller's TEAMS resolves (teams are grantees, D-A1)", async () => {
    const backend = await openBackend(kind);
    try {
      await seedProject(backend, OWNER);
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      await orgs.createOrg({
        id: "org-b",
        slug: "org-b",
        name: "Org B",
        createdBy: OUTSIDER,
      });
      await orgs.addMember("org-b", OUTSIDER, "member");
      await teams.createTeam({
        id: "team-1",
        orgId: "org-b",
        slug: "core",
        name: "Core",
        createdBy: OUTSIDER,
      });
      await teams.addMember("team-1", OUTSIDER);
      await backend.store.shares.grant({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "team",
        granteeId: "team-1",
        role: "read",
        grantedBy: OWNER,
      });
      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(
        req(),
        OWNER,
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.role, "read");
    } finally {
      await backend.close();
    }
  });

  it("a revoked grant is refused on the very next call, with no cache in between", async () => {
    const backend = await openBackend(kind);
    try {
      await seedProject(backend, OWNER);
      const shares = backend.store.shares;
      await shares.grant({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "user",
        granteeId: OUTSIDER,
        role: "write",
        grantedBy: OWNER,
      });
      signedInAs(OUTSIDER);

      // Non-vacuity: the grant must WORK first, or "refused after revoke" is
      // indistinguishable from "never worked".
      const before = await resolveProjectAccess(
        req(),
        OWNER,
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(before.ok, true, "the grant must resolve before revocation");

      await shares.revoke({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "user",
        granteeId: OUTSIDER,
      });

      const after = await resolveProjectAccess(
        req(),
        OWNER,
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(after.ok, false, "revocation takes effect immediately");
      if (!after.ok) assert.equal(after.response.status, 403);
    } finally {
      await backend.close();
    }
  });

  it("the strongest grant wins when a caller is reached more than one way", async () => {
    const backend = await openBackend(kind);
    try {
      await seedProject(backend, OWNER);
      const orgs = backend.store.orgs;
      const shares = backend.store.shares;
      await orgs.createOrg({
        id: "org-b",
        slug: "org-b",
        name: "Org B",
        createdBy: OUTSIDER,
      });
      await orgs.addMember("org-b", OUTSIDER, "member");
      // read directly, write through the org: the answer must not depend on
      // which row the database happens to return first.
      await shares.grant({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "user",
        granteeId: OUTSIDER,
        role: "read",
        grantedBy: OWNER,
      });
      await shares.grant({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "org",
        granteeId: "org-b",
        role: "write",
        grantedBy: OWNER,
      });
      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(
        req(),
        OWNER,
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.role, "write");
    } finally {
      await backend.close();
    }
  });

  it("an org member reaches the org tenant's projects as owner", async () => {
    const backend = await openBackend(kind);
    try {
      await seedProject(backend, "org-a");
      const orgs = backend.store.orgs;
      await orgs.createOrg({
        id: "org-a",
        slug: "org-a",
        name: "Org A",
        createdBy: OWNER,
      });
      await orgs.addMember("org-a", OUTSIDER, "member");
      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(
        req(),
        "org-a",
        PROJECT,
        buildReaders(backend),
      );
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.role, "owner");
        assert.equal(r.ownerId, "org-a");
        assert.equal(r.actorUserId, OUTSIDER);
      }
    } finally {
      await backend.close();
    }
  });
});
