// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { DuplicateTeamSlugError, NotAnOrgMemberError } from "../teams-store";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";

describe.each(BACKENDS)("TeamsRepository (%s", (kind) => {
  it("TM1: a duplicate slug in one org is DuplicateTeamSlugError; another org may reuse it; a duplicate id is not a slug error", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;

      const orgA = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );
      const orgB = await orgs.createOrgWithOwner(
        { slug: "acme-b", name: "Acme B", createdBy: "founder" },
        { actorId: "founder" },
      );

      const team = await teams.createTeam(
        { orgId: orgA.id, slug: "dev", name: "Dev", createdBy: "founder" },
        { actorId: "founder" },
      );

      await assert.rejects(
        () =>
          teams.createTeam(
            {
              slug: "dev",
              name: "Dev Two",
              createdBy: "founder",
              orgId: orgA.id,
            },
            { actorId: "founder" },
          ),
        (err: unknown) => {
          assert.ok(
            err instanceof DuplicateTeamSlugError,
            `expected DuplicateTeamSlugError, got ${(err as Error)?.name}`,
          );
          assert.equal((err as DuplicateTeamSlugError).orgId, orgA.id);
          assert.equal((err as DuplicateTeamSlugError).slug, "dev");
          return true;
        },
      );
      assert.equal((await teams.listTeamsForOrg(orgA.id)).length, 1);

      const teamB = await teams.createTeam(
        { slug: "dev", name: "Dev", createdBy: "founder", orgId: orgB.id },
        { actorId: "founder" },
      );
      assert.equal(teamB.slug, "dev");

      await assert.rejects(
        () =>
          teams.createTeam(
            {
              id: team.id,
              slug: "ops",
              name: "Ops",
              createdBy: "founder",
              orgId: orgA.id,
            },
            { actorId: "founder" },
          ),
        (err: unknown) => {
          assert.ok(
            backend.db.isUniqueViolation(err),
            `expected a unique violation, got ${(err as Error)?.name}`,
          );
          assert.ok(
            !(err instanceof DuplicateTeamSlugError),
            "a duplicate id must not become DuplicateTeamSlugError",
          );
          return true;
        },
      );
    } finally {
      await backend.close();
    }
  });

  it("TM2: team membership add is idempotent and reports it, isMember and listTeamIdsForUser agree", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const audit = backend.store.audit;

      const org = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      const team1 = await teams.createTeam(
        { slug: "aaa", name: "AAA", createdBy: "founder", orgId: org.id },
        { actorId: "founder" },
      );
      const team2 = await teams.createTeam(
        { slug: "bbb", name: "BBB", createdBy: "founder", orgId: org.id },
        { actorId: "founder" },
      );

      await teams.addMember(team1.id, "founder", { actorId: "founder" });
      await teams.addMember(team1.id, "founder", { actorId: "founder" });
      await teams.addMember(team2.id, "founder", { actorId: "founder" });

      assert.equal(await audit.countFor("team.member.add", team1.id), 1);

      assert.equal(await teams.isMember(team1.id, "founder"), true);
      assert.equal(await teams.isMember(team1.id, "stranger"), false);

      const ids = await teams.listTeamIdsForUser("founder");
      // Both teams, and nothing else, in id order.
      assert.deepEqual(ids, [team1.id, team2.id].sort());

      await assert.rejects(
        () => teams.addMember(team1.id, "stranger", { actorId: "founder" }),
        (err: unknown) => {
          assert.ok(
            err instanceof NotAnOrgMemberError,
            `expected NotAnOrgMemberError, got ${(err as Error)?.name}`,
          );
          return true;
        },
      );
    } finally {
      await backend.close();
    }
  });
});
