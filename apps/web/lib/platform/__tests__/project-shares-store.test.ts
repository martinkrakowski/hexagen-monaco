// @vitest-environment node
import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  ShareProjectNotFoundError,
  revokeSharesForProject,
  revokeSharesToTeam,
  type GranteeType,
  type ShareRole,
} from "../project-shares-store";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";
import type { Backend } from "../../../test-support/platform-backends";
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

describe.each(BACKENDS)("ProjectSharesRepository (%s", (kind) => {
  let backend: Backend;

  beforeEach(async () => {
    backend = await openBackend(kind);
  });
  afterEach(async () => {
    await backend.close();
  });

  it("SH1: a grant on a project that does not exist is refused and writes nothing", async () => {
    const shares = backend.store.shares;
    const projectId = "missing-project";
    await assert.rejects(
      () =>
        shares.grant(
          {
            ownerId: "user-1",
            projectId,
            granteeType: "user",
            granteeId: "user-2",
            role: "read",
            grantedBy: "user-2",
          },
          { actorId: "user-2" },
        ),
      (err: unknown) => {
        assert.ok(
          err instanceof ShareProjectNotFoundError,
          `expected ShareProjectNotFoundError, got ${(err as Error)?.name}`,
        );
        return true;
      },
    );

    assert.equal(
      (await shares.listForProject("user-1", projectId)).length,
      0,
      "listForProject is empty",
    );
    assert.equal(
      await backend.store.audit.countFor("share.grant", projectId),
      0,
      "no share.grant audit row should have been written",
    );
  });

  it("SH2: a grant is one row per (owner, project, grantee type, grantee)", async () => {
    const shares = backend.store.shares;
    const owner = "user-1";
    const projectId = "proj-sh2";
    must(
      await backend.store.projectsFor(owner).createProjectRecord({
        id: projectId,
        name: "P",
        schemaVersion: 4,
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject),
    );
    const count = async (gt: string, gid: string) =>
      defined(
        await backend.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ? AND project_id = ? AND grantee_type = ? AND grantee_id = ?",
          [owner, projectId, gt, gid],
        ),
        "count",
      ).n;

    const roleOf = async (gt: string, gid: string) =>
      defined(
        await backend.db.get<{ role: string; revoked_at: string | null }>(
          "SELECT role, revoked_at FROM project_shares WHERE owner_id = ? AND project_id = ? AND grantee_type = ? AND grantee_id = ?",
          [owner, projectId, gt, gid],
        ),
        "row",
      );

    await shares.grant(
      {
        ownerId: owner,
        projectId,
        granteeType: "user",
        granteeId: "u2",
        role: "read",
        grantedBy: "u2",
      },
      { actorId: "u2" },
    );
    assert.equal(typeof (await count("user", "u2")), "number");
    assert.equal(await count("user", "u2"), 1);

    await shares.grant(
      {
        ownerId: owner,
        projectId,
        granteeType: "user",
        granteeId: "u2",
        role: "write",
        grantedBy: "u2",
      },
      { actorId: "u2" },
    );
    assert.equal((await roleOf("user", "u2")).role, "write", "last role wins");

    await shares.revoke(
      { ownerId: owner, projectId, granteeType: "user", granteeId: "u2" },
      { actorId: "u2" },
    );
    await shares.grant(
      {
        ownerId: owner,
        projectId,
        granteeType: "user",
        granteeId: "u2",
        role: "read",
        grantedBy: "u2",
      },
      { actorId: "u2" },
    );
    assert.equal(await count("user", "u2"), 1, "still one row after re-grant");
    assert.equal(
      (await roleOf("user", "u2")).revoked_at,
      null,
      "revoked_at NULL after re-grant",
    );

    await shares.grant(
      {
        ownerId: owner,
        projectId,
        granteeType: "org",
        granteeId: "u2",
        role: "read",
        grantedBy: "u2",
      },
      { actorId: "u2" },
    );
    assert.equal(
      defined(
        await backend.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ? AND project_id = ?",
          [owner, projectId],
        ),
        "count",
      ).n,
      2,
      "user and org grants are separate rows",
    );
  });

  it("SH3: revoke touches only the named grant", async () => {
    const shares = backend.store.shares;
    const owner = "user-1";
    const projectId = "proj-sh3";
    must(
      await backend.store.projectsFor(owner).createProjectRecord({
        id: projectId,
        name: "P",
        schemaVersion: 4,
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject),
    );
    await shares.grant(
      {
        ownerId: owner,
        projectId,
        granteeType: "user",
        granteeId: "u2",
        role: "read",
        grantedBy: "u2",
      },
      { actorId: "u2" },
    );
    await shares.grant(
      {
        ownerId: owner,
        projectId,
        granteeType: "user",
        granteeId: "u3",
        role: "write",
        grantedBy: "u2",
      },
      { actorId: "u2" },
    );

    await shares.revoke(
      { ownerId: owner, projectId, granteeType: "user", granteeId: "u2" },
      { actorId: "u2" },
    );
    const live = await shares.listForProject(owner, projectId);
    assert.equal(live.length, 1, "only the other grantee remains live");
    assert.equal(live[0]?.granteeId, "u3");

    const row = defined(
      await backend.db.get<{ revoked_at: string | null }>(
        "SELECT revoked_at FROM project_shares WHERE owner_id = ? AND project_id = ? AND grantee_type = ? AND grantee_id = ?",
        [owner, projectId, "user", "u2"],
      ),
      "revoked row",
    );
    assert.ok(row.revoked_at, "revoked_at of the revoked one is an ISO string");

    assert.equal(
      await backend.store.audit.countFor("share.revoke", projectId),
      1,
      "one revoke audit row",
    );
    await shares.revoke(
      { ownerId: owner, projectId, granteeType: "user", granteeId: "u2" },
      { actorId: "u2" },
    );
    assert.equal(
      await backend.store.audit.countFor("share.revoke", projectId),
      1,
      "second revoke writes no audit row",
    );
  });

  it("SH4: accessFor returns the strongest role over user, org and team grants, with 0, 1 and 3 ids", async () => {
    const shares = backend.store.shares;
    const owner = "user-1";
    const projectId = "proj-sh4";
    must(
      await backend.store.projectsFor(owner).createProjectRecord({
        id: projectId,
        name: "P",
        schemaVersion: 4,
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject),
    );
    const grantTo = (gt: GranteeType, gid: string, role: ShareRole) =>
      shares.grant(
        {
          ownerId: owner,
          projectId,
          granteeType: gt,
          granteeId: gid,
          role,
          grantedBy: "me",
        },
        { actorId: "me" },
      );
    await grantTo("user", "me", "read");
    await grantTo("org", "org-1", "read");
    await grantTo("team", "team-1", "write");

    // Strongest: team=write beats user/org=read.
    assert.equal(
      await shares.accessFor(owner, projectId, {
        userId: "me",
        orgIds: ["org-1"],
        teamIds: ["team-1"],
      }),
      "write",
    );
    // No org/team ids: only the user grant counts.
    assert.equal(
      await shares.accessFor(owner, projectId, {
        userId: "me",
        orgIds: [],
        teamIds: [],
      }),
      "read",
    );
    // Three org ids and three team ids (six ? after the first): right grant found.
    assert.equal(
      await shares.accessFor(owner, projectId, {
        userId: "me",
        orgIds: ["org-1", "org-x", "org-y"],
        teamIds: ["team-1", "team-x", "team-y"],
      }),
      "write",
    );
    // Revoke team grant: revoked_at IS NULL lost → would still see write.
    await shares.revoke(
      { ownerId: owner, projectId, granteeType: "team", granteeId: "team-1" },
      { actorId: "me" },
    );
    assert.equal(
      await shares.accessFor(owner, projectId, {
        userId: "me",
        orgIds: ["org-1"],
        teamIds: ["team-1"],
      }),
      "read",
    );
  });

  it("SH5: selectSharedWith excludes the caller's own and org-owned projects, collapses to the strongest and honours the project filter", async () => {
    const shares = backend.store.shares;
    const me = "me";
    const orgId = "org-1";
    const foreign = "foreign";
    const ownProj = "own-proj";
    const orgProj = "org-proj";
    const f2 = "f-proj-2";
    const f1 = "f-proj";
    must(
      await backend.store.projectsFor(me).createProjectRecord({
        id: ownProj,
        name: "O",
        schemaVersion: 4,
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject),
    );
    must(
      await backend.store.projectsFor(orgId).createProjectRecord({
        id: orgProj,
        name: "OP",
        schemaVersion: 4,
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject),
    );
    must(
      await backend.store.projectsFor(foreign).createProjectRecord({
        id: f1,
        name: "F1",
        schemaVersion: 4,
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject),
    );
    must(
      await backend.store.projectsFor(foreign).createProjectRecord({
        id: f2,
        name: "F2",
        schemaVersion: 4,
        createdAt: 1,
        updatedAt: 1,
        formState: {},
        manifestYaml: "",
      } as unknown as SavedProject),
    );

    await shares.grant(
      {
        ownerId: me,
        projectId: ownProj,
        granteeType: "user",
        granteeId: me,
        role: "read",
        grantedBy: me,
      },
      { actorId: me },
    );
    await shares.grant(
      {
        ownerId: orgId,
        projectId: orgProj,
        granteeType: "org",
        granteeId: orgId,
        role: "read",
        grantedBy: me,
      },
      { actorId: me },
    );
    await shares.grant(
      {
        ownerId: foreign,
        projectId: f1,
        granteeType: "user",
        granteeId: me,
        role: "read",
        grantedBy: me,
      },
      { actorId: me },
    );
    await shares.grant(
      {
        ownerId: foreign,
        projectId: f1,
        granteeType: "org",
        granteeId: orgId,
        role: "write",
        grantedBy: me,
      },
      { actorId: me },
    );
    await shares.grant(
      {
        ownerId: foreign,
        projectId: f2,
        granteeType: "user",
        granteeId: me,
        role: "write",
        grantedBy: me,
      },
      { actorId: me },
    );

    const identity = { userId: me, orgIds: [orgId], teamIds: [] as const };
    const all = await shares.selectSharedWith(identity);
    assert.equal(all.length, 2, "own and org-owned projects excluded");
    assert.equal(all[0]?.projectId, f2, "order by ord ASC (newer first)");
    assert.equal(all[0]?.role, "write");
    assert.equal(all[1]?.projectId, f1, "collapsed to strongest role");
    assert.equal(all[1]?.role, "write", "user read + org write → write");

    const filtered = await shares.selectSharedWith(identity, f1);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.projectId, f1);
    assert.equal(filtered[0]?.role, "write");
  });

  it("SH6: revokeSharesForProject and revokeSharesToTeam return counts and are scoped", async () => {
    const shares = backend.store.shares;
    const owner = "owner-6";
    const p1 = "p-share-1";
    const p2 = "p-share-2";
    const p3 = "p-share-3";
    const p4 = "p-share-4";
    for (const id of [p1, p2, p3, p4])
      must(
        await backend.store.projectsFor(owner).createProjectRecord({
          id,
          name: "P",
          schemaVersion: 4,
          createdAt: 1,
          updatedAt: 1,
          formState: {},
          manifestYaml: "",
        } as unknown as SavedProject),
      );

    // p1 gets 3 live grants (user, org, team); p2 gets 1.
    await shares.grant(
      {
        ownerId: owner,
        projectId: p1,
        granteeType: "user",
        granteeId: "u1",
        role: "read",
        grantedBy: "u1",
      },
      { actorId: "u1" },
    );
    await shares.grant(
      {
        ownerId: owner,
        projectId: p1,
        granteeType: "org",
        granteeId: "o1",
        role: "read",
        grantedBy: "u1",
      },
      { actorId: "u1" },
    );
    await shares.grant(
      {
        ownerId: owner,
        projectId: p1,
        granteeType: "team",
        granteeId: "t1",
        role: "write",
        grantedBy: "u1",
      },
      { actorId: "u1" },
    );
    await shares.grant(
      {
        ownerId: owner,
        projectId: p2,
        granteeType: "user",
        granteeId: "u2",
        role: "read",
        grantedBy: "u1",
      },
      { actorId: "u1" },
    );

    // revokeSharesForProject: returns 3, leaves p2.
    const removed = await backend.db.transaction((tx) =>
      revokeSharesForProject(tx, owner, p1),
    );
    assert.equal(typeof removed, "number");
    assert.equal(removed, 3, "revokeSharesForProject returns 3");
    assert.equal(
      (await shares.listForProject(owner, p1)).length,
      0,
      "p1 all revoked",
    );
    assert.equal(
      (await shares.listForProject(owner, p2)).length,
      1,
      "p2 untouched",
    );

    // Team t1 grants on p3 and p4; user and org grants on p3 must survive.
    await shares.grant(
      {
        ownerId: owner,
        projectId: p3,
        granteeType: "user",
        granteeId: "u3",
        role: "read",
        grantedBy: "u3",
      },
      { actorId: "u3" },
    );
    await shares.grant(
      {
        ownerId: owner,
        projectId: p3,
        granteeType: "org",
        granteeId: "o2",
        role: "read",
        grantedBy: "u3",
      },
      { actorId: "u3" },
    );
    await shares.grant(
      {
        ownerId: owner,
        projectId: p3,
        granteeType: "team",
        granteeId: "t2",
        role: "write",
        grantedBy: "u3",
      },
      { actorId: "u3" },
    );
    await shares.grant(
      {
        ownerId: owner,
        projectId: p4,
        granteeType: "team",
        granteeId: "t2",
        role: "read",
        grantedBy: "u3",
      },
      { actorId: "u3" },
    );

    const teamRemoved = await backend.db.transaction((tx) =>
      revokeSharesToTeam(tx, "t2"),
    );
    assert.equal(typeof teamRemoved, "number");
    assert.equal(teamRemoved, 2, "revokeSharesToTeam returns 2");
    assert.equal(
      (await shares.listForProject(owner, p3)).length,
      2,
      "user+org untouched on p3",
    );
    assert.equal(
      (await shares.listForProject(owner, p4)).length,
      0,
      "team t2 revoked on p4",
    );

    // Already-revoked grants not counted: revoke t2 again → 0.
    const again = await backend.db.transaction((tx) =>
      revokeSharesToTeam(tx, "t2"),
    );
    assert.equal(again, 0, "already-revoked grants not counted");
  });
});
