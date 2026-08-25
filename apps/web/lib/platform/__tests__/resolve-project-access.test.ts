import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { openPlatformDb } from "../platform-db";
import { createOrgsRepository } from "../orgs-store";
import { createTeamsRepository } from "../teams-store";
import { createProjectSharesRepository } from "../project-shares-store";
import { createSavedProjectsStore } from "../saved-projects-store";
import {
  resolveProjectAccess,
  type ProjectAccessReaders,
} from "../require-owner";
import type { SavedProject } from "@hexagen/shared";

/**
 * P-A3 — who may reach a project, and as what.
 *
 * The headline case is the cross-tenant read: a signed-in user who is NOT the
 * owner and holds no grant must be refused, AND the project must be proven to
 * exist in the owner's tenant. Without that second assertion the test passes
 * over an empty database, which would make it agree with a broken
 * implementation.
 */

const OWNER = "user-owner";
const OUTSIDER = "user-outsider";
const PROJECT = "11111111-1111-4111-8111-111111111111";

function fixture() {
  const path = join(
    mkdtempSync(join(tmpdir(), "hexagen-project-access-")),
    "platform.db",
  );
  const db = openPlatformDb(path);
  const orgs = createOrgsRepository(db);
  const teams = createTeamsRepository(db);
  const shares = createProjectSharesRepository(db);
  const readers: ProjectAccessReaders = {
    memberRole: (orgId, userId) => orgs.memberRole(orgId, userId),
    listOrgIdsForUser: (userId) => orgs.listOrgIdsForUser(userId),
    listTeamIdsForUser: (userId) => teams.listTeamIdsForUser(userId),
    accessFor: (ownerId, projectId, identity) =>
      shares.accessFor(ownerId, projectId, identity),
  };
  return { db, orgs, teams, shares, readers };
}

function project(id: string): SavedProject {
  const now = Date.now();
  return {
    id,
    name: "Owner's project",
    createdAt: now,
    updatedAt: now,
  } as SavedProject;
}

async function seedProject(
  db: ReturnType<typeof openPlatformDb>,
  ownerId: string,
): Promise<void> {
  const store = createSavedProjectsStore(db, ownerId);
  const created = await store.createProjectRecord(project(PROJECT));
  assert.equal(created.success, true, "fixture project must be created");
}

const req = () =>
  new NextRequest(`http://localhost/api/tenants/${OWNER}/projects/${PROJECT}`);

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

describe("P-A3 — resolveProjectAccess", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset();
  });

  it("401 without a JWT sub", async () => {
    const { db, readers } = fixture();
    try {
      signedInAs(null);
      const r = await resolveProjectAccess(req(), OWNER, PROJECT, readers);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.response.status, 401);
    } finally {
      db.close();
    }
  });

  it("the owner of their own tenant gets role owner", async () => {
    const { db, readers } = fixture();
    try {
      await seedProject(db, OWNER);
      signedInAs(OWNER);
      const r = await resolveProjectAccess(req(), OWNER, PROJECT, readers);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.role, "owner");
        assert.equal(r.ownerId, OWNER);
        assert.equal(r.actorUserId, OWNER);
      }
    } finally {
      db.close();
    }
  });

  it("cross-tenant read is 403 — and the project DOES exist in the owner's tenant", async () => {
    const { db, orgs, readers } = fixture();
    try {
      await seedProject(db, OWNER);
      // The outsider is a real, signed-in user with an org of their own, so
      // the refusal cannot be "this user has no identity".
      await orgs.createOrg({
        id: "org-b",
        slug: "org-b",
        name: "Org B",
        createdBy: OUTSIDER,
      });
      await orgs.addMember("org-b", OUTSIDER, "owner");

      // Non-vacuity: prove the row is there before asserting the refusal, so
      // the 403 is an authorization decision and not a 404 in disguise.
      const owned = createSavedProjectsStore(db, OWNER).getProject(PROJECT);
      assert.equal(owned.success, true);
      if (owned.success) {
        assert.ok(owned.value, "the project must exist in the owner's tenant");
        assert.equal(owned.value?.id, PROJECT);
      }

      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(req(), OWNER, PROJECT, readers);
      assert.equal(r.ok, false, "an outsider must not reach another tenant");
      if (!r.ok) assert.equal(r.response.status, 403);
    } finally {
      db.close();
    }
  });

  it("a direct user grant resolves to its role", async () => {
    const { db, shares, readers } = fixture();
    try {
      await seedProject(db, OWNER);
      await shares.grant({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "user",
        granteeId: OUTSIDER,
        role: "read",
        grantedBy: OWNER,
      });
      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(req(), OWNER, PROJECT, readers);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.role, "read");
        assert.equal(r.ownerId, OWNER, "the store is built for the REAL owner");
        assert.equal(r.actorUserId, OUTSIDER);
      }
    } finally {
      db.close();
    }
  });

  it("a grant to one of the caller's ORGS resolves", async () => {
    const { db, orgs, shares, readers } = fixture();
    try {
      await seedProject(db, OWNER);
      await orgs.createOrg({
        id: "org-b",
        slug: "org-b",
        name: "Org B",
        createdBy: OUTSIDER,
      });
      await orgs.addMember("org-b", OUTSIDER, "member");
      await shares.grant({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "org",
        granteeId: "org-b",
        role: "write",
        grantedBy: OWNER,
      });
      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(req(), OWNER, PROJECT, readers);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.role, "write");
    } finally {
      db.close();
    }
  });

  it("a grant to one of the caller's TEAMS resolves (teams are grantees, D-A1)", async () => {
    const { db, orgs, teams, shares, readers } = fixture();
    try {
      await seedProject(db, OWNER);
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
      await shares.grant({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "team",
        granteeId: "team-1",
        role: "read",
        grantedBy: OWNER,
      });
      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(req(), OWNER, PROJECT, readers);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.role, "read");
    } finally {
      db.close();
    }
  });

  it("a revoked grant is refused on the very next call, with no cache in between", async () => {
    const { db, shares, readers } = fixture();
    try {
      await seedProject(db, OWNER);
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
      const before = await resolveProjectAccess(req(), OWNER, PROJECT, readers);
      assert.equal(before.ok, true, "the grant must resolve before revocation");

      await shares.revoke({
        ownerId: OWNER,
        projectId: PROJECT,
        granteeType: "user",
        granteeId: OUTSIDER,
      });

      const after = await resolveProjectAccess(req(), OWNER, PROJECT, readers);
      assert.equal(after.ok, false, "revocation takes effect immediately");
      if (!after.ok) assert.equal(after.response.status, 403);
    } finally {
      db.close();
    }
  });

  it("the strongest grant wins when a caller is reached more than one way", async () => {
    const { db, orgs, shares, readers } = fixture();
    try {
      await seedProject(db, OWNER);
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
      const r = await resolveProjectAccess(req(), OWNER, PROJECT, readers);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.role, "write");
    } finally {
      db.close();
    }
  });

  it("an org member reaches the org tenant's projects as owner", async () => {
    const { db, orgs, readers } = fixture();
    try {
      await seedProject(db, "org-a");
      await orgs.createOrg({
        id: "org-a",
        slug: "org-a",
        name: "Org A",
        createdBy: OWNER,
      });
      await orgs.addMember("org-a", OUTSIDER, "member");
      signedInAs(OUTSIDER);
      const r = await resolveProjectAccess(req(), "org-a", PROJECT, readers);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.role, "owner");
        assert.equal(r.ownerId, "org-a");
        assert.equal(r.actorUserId, OUTSIDER);
      }
    } finally {
      db.close();
    }
  });
});
