// @vitest-environment node
import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { ShareProjectNotFoundError } from "../project-shares-store";
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
});
