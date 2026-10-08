import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPlatformStore } from "../store";
import type { SavedProject } from "@hexagen/shared";
import {
  DuplicateOrgSlugError,
  LastOwnerError,
  OrgOwnsProjectsError,
} from "../orgs-store";

describe("OrgsRepository.listOrgsForUser", () => {
  it("returns this caller's orgs with roles, and nobody else's", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const acme = await store.orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "user-1",
      });
      const beta = await store.orgs.createOrg({
        slug: "beta",
        name: "Beta",
        createdBy: "user-2",
      });
      await store.orgs.addMember(acme.id, "user-1", "owner");
      await store.orgs.addMember(acme.id, "user-2", "member");
      await store.orgs.addMember(beta.id, "user-2", "owner");

      const forUser1 = await store.orgs.listOrgsForUser("user-1");
      assert.equal(forUser1.length, 1);
      assert.equal(forUser1[0]?.id, acme.id);
      assert.equal(forUser1[0]?.slug, "acme");
      assert.equal(forUser1[0]?.name, "Acme");
      assert.equal(forUser1[0]?.role, "owner");

      const forUser2 = await store.orgs.listOrgsForUser("user-2");
      assert.equal(forUser2.length, 2);
      const bySlug = Object.fromEntries(forUser2.map((o) => [o.slug, o.role]));
      assert.equal(bySlug.acme, "member");
      assert.equal(bySlug.beta, "owner");

      const forStranger = await store.orgs.listOrgsForUser("nobody");
      assert.equal(forStranger.length, 0);
    } finally {
      store.close();
    }
  });
});

describe("OrgsRepository — typed error refusals", () => {
  it("createOrgWithOwner with a taken slug rejects with DuplicateOrgSlugError and leaves no second org, no membership and no audit row", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const org = await store.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      // Non-vacuity: "other" has no orgs yet.
      assert.equal((await store.orgs.listOrgsForUser("other")).length, 0);

      await assert.rejects(
        () =>
          store.orgs.createOrgWithOwner(
            { slug: "acme", name: "Acme Again", createdBy: "other" },
            { actorId: "other" },
          ),
        (err: unknown) => {
          assert.ok(
            err instanceof DuplicateOrgSlugError,
            `expected DuplicateOrgSlugError, got ${(err as Error)?.name}`,
          );
          assert.equal((err as DuplicateOrgSlugError).slug, "acme");
          return true;
        },
      );

      // No second org for "other".
      assert.equal(
        (await store.orgs.listOrgsForUser("other")).length,
        0,
        "the failed create must not list an org for the second user",
      );
      // No membership for "other" in the org.
      assert.equal(
        await store.orgs.memberRole(org.id, "other"),
        null,
        "the failed create must not add a membership",
      );
      // No second audit row: the original org.create is the only one.
      assert.equal(
        await store.audit.countFor("org.create", org.id),
        1,
        "the failed create must not write an audit row",
      );
    } finally {
      store.close();
    }
  });

  it("demoting or removing the last owner rejects with LastOwnerError and the member stays an owner", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const org = await store.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      // Demoting: founder is the only owner, so demotion to member must refuse.
      await assert.rejects(
        () => store.orgs.addMember(org.id, "founder", "member"),
        (err: unknown) => {
          assert.ok(err instanceof LastOwnerError);
          return true;
        },
      );
      // The founder is still an owner — the refusal rolled back.
      assert.equal(await store.orgs.memberRole(org.id, "founder"), "owner");

      // Removing the last owner must also refuse.
      await assert.rejects(
        () => store.orgs.removeMember(org.id, "founder"),
        (err: unknown) => {
          assert.ok(err instanceof LastOwnerError);
          return true;
        },
      );
      assert.equal(await store.orgs.memberRole(org.id, "founder"), "owner");
    } finally {
      store.close();
    }
  });

  it("deleteOrg of an org that owns a project rejects with OrgOwnsProjectsError; org, members and teams survive", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const org = await store.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );
      await store.orgs.addMember(org.id, "member-1", "member");
      const team = await store.teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });

      // Non-vacuity: the org owns a project before the deletion attempt.
      const project = {
        id: "p-1",
        name: "Project",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as SavedProject;
      const created = await store
        .projectsFor(org.id)
        .createProjectRecord(project);
      assert.equal(created.success, true, "fixture project must be created");

      await assert.rejects(
        () => store.orgs.deleteOrg(org.id, { actorId: "owner-1" }),
        (err: unknown) => {
          assert.ok(err instanceof OrgOwnsProjectsError);
          return true;
        },
      );

      // Org survives.
      assert.ok(await store.orgs.getOrg(org.id), "org must survive the refusal");
      // Member survives.
      assert.equal(
        await store.orgs.memberRole(org.id, "member-1"),
        "member",
        "member must survive the refusal",
      );
      // Team survives.
      const teams = await store.teams.listTeamsForOrg(org.id);
      assert.equal(teams.length, 1, "team must survive the refusal");
      assert.equal(teams[0]?.id, team.id);
    } finally {
      store.close();
    }
  });
});
