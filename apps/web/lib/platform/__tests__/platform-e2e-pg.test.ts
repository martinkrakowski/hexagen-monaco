// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AdapterUser } from "next-auth/adapters";
import type { SavedProject } from "@hexagen/shared";
import type { Pool } from "pg";
import { createTestPgDb } from "../../../test-support/pg-test-db";
import { runStartupMigrations } from "../pg-startup";
import { getPlatformStore, closePlatformStore } from "../store";
import type { PlatformStore } from "../store";
import {
  DuplicateOrgSlugError,
  OrgOwnsProjectsError,
  type Org,
} from "../orgs-store";
import { DuplicateTeamSlugError, type Team } from "../teams-store";
import { ShareProjectNotFoundError } from "../project-shares-store";

function must<T>(
  r: { success: true; value: T } | { success: false; error: unknown },
): T {
  if (!r.success) {
    throw new Error(`expected success, got ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

describe("platform end-to-end on Postgres", () => {
  let pool: Pool;
  let url: string;
  let drop: () => Promise<void>;
  let savedDbUrl: string | undefined;
  let savedDbPath: string | undefined;
  let store: PlatformStore;
  let ada: AdapterUser;
  let bob: AdapterUser;
  let org: Org;
  let team: Team;
  let project: SavedProject;

  beforeAll(async () => {
    const result = await createTestPgDb({ empty: true });
    pool = result.pool;
    url = result.url;
    drop = result.drop;
    savedDbUrl = process.env.DATABASE_URL;
    savedDbPath = process.env.PLATFORM_DB_PATH;
    expect((await runStartupMigrations(url)).applied).toEqual([1, 2, 3]);
    process.env.DATABASE_URL = url;
    delete process.env.PLATFORM_DB_PATH;
    store = getPlatformStore();
  });

  afterAll(async () => {
    await closePlatformStore();
    if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDbUrl;
    if (savedDbPath === undefined) delete process.env.PLATFORM_DB_PATH;
    else process.env.PLATFORM_DB_PATH = savedDbPath;
    await drop();
  });

  it("AUTH: two users via createUser/linkAccount/setGithubLogin; getUserByGithubLogin finds ada", async () => {
    ada = await store.auth.createUser({
      name: "Ada",
      email: "ada@example.com",
      emailVerified: null,
    });
    await store.auth.linkAccount({
      provider: "github",
      providerAccountId: "gh-ada",
      userId: ada.id,
      type: "oauth",
    } as never);
    await store.auth.setGithubLogin(ada.id, "ada");

    bob = await store.auth.createUser({
      name: "Bob",
      email: "bob@example.com",
      emailVerified: null,
    });
    await store.auth.linkAccount({
      provider: "github",
      providerAccountId: "gh-bob",
      userId: bob.id,
      type: "oauth",
    } as never);
    await store.auth.setGithubLogin(bob.id, "bob");

    expect((await store.auth.getUserByGithubLogin("ADA"))?.id).toBe(ada.id);

    const raw = await pool.query<{ github_login: string | null }>(
      "SELECT github_login FROM users WHERE id = $1",
      [ada.id],
    );
    expect(raw.rows[0].github_login).toBe("ada");
  });

  it("ORGS: createOrgWithOwner/duplicate slug/invite/accept/memberRole/listOrgsForUser", async () => {
    org = await store.orgs.createOrgWithOwner(
      { slug: "acme", name: "Acme", createdBy: ada.id },
      { actorId: ada.id },
    );

    await expect(
      store.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: ada.id },
        { actorId: ada.id },
      ),
    ).rejects.toBeInstanceOf(DuplicateOrgSlugError);

    const invite = await store.orgs.invite(
      org.id,
      "BOB",
      "member",
      { actorId: ada.id },
    );
    expect(invite.githubLogin).toBe("bob");

    const pending = await store.orgs.listPendingInvites(org.id);
    expect(pending).toHaveLength(1);
    expect(pending[0].githubLogin).toBe("bob");

    const joined = await store.orgs.acceptInvitesForLogin(bob.id, "Bob");
    expect(joined).toEqual([org.id]);

    expect(await store.orgs.memberRole(org.id, bob.id)).toBe("member");

    const orgsForUser = await store.orgs.listOrgsForUser(bob.id);
    expect(orgsForUser).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: org.id,
          slug: "acme",
          name: "Acme",
          role: "member",
        }),
      ]),
    );

    const raw = await pool.query<{ slug: string }>(
      "SELECT slug FROM orgs WHERE id = $1",
      [org.id],
    );
    expect(raw.rows[0].slug).toBe("acme");
  });

  it("TEAMS: createTeam/duplicate slug/addMember/isMember", async () => {
    team = await store.teams.createTeam(
      { orgId: org.id, slug: "core", name: "Core", createdBy: ada.id },
      { actorId: ada.id },
    );

    await expect(
      store.teams.createTeam(
        {
          orgId: org.id,
          slug: "core",
          name: "Core copy",
          createdBy: ada.id,
        },
        { actorId: ada.id },
      ),
    ).rejects.toBeInstanceOf(DuplicateTeamSlugError);

    await store.teams.addMember(team.id, bob.id, { actorId: ada.id });

    expect(await store.teams.isMember(team.id, bob.id)).toBe(true);

    const raw = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS n FROM team_members WHERE team_id = $1 AND user_id = $2",
      [team.id, bob.id],
    );
    expect(Number(raw.rows[0].n)).toBe(1);
  });

  /* __NEXT_STEP__ */
});
