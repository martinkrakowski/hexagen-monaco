import { getPlatformStore } from "../../lib/platform";
import type { GranteeType } from "../../lib/platform/project-shares-store";

/**
 * Resolve a share handle to a grantee, exact-match only (D-A4).
 *
 * Three shapes, and nothing else:
 *
 *   @login            a user, by `users.github_login` (P-A1)
 *   @org-slug         an org, by `orgs.slug`
 *   @org-slug/team    a team, by `teams.slug` scoped to that org
 *
 * There is deliberately NO search endpoint, no prefix match and no listing.
 * Cross-org discovery is not a feature (D-A4): if you cannot type the handle
 * you cannot find it. That is what stops this becoming an enumeration oracle
 * over every user and org in the system.
 *
 * The anti-enumeration property belongs to the CALLER, not to this function:
 * it returns `null` for "no such handle" and the route maps every null to the
 * SAME 404 body it uses for a handle that exists but that the caller may not
 * target. A distinguishable response — a different message, a different
 * status, an early return that skips work — turns the share endpoint into a
 * membership oracle.
 */
export interface ResolvedGrantee {
  granteeType: GranteeType;
  granteeId: string;
}

const LOGIN = /^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)$/;
const ORG_TEAM =
  /^@([a-z0-9][a-z0-9-]{0,38}[a-z0-9])\/([a-z0-9][a-z0-9-]{0,38}[a-z0-9])$/;

export async function resolveShareHandle(
  handle: string,
): Promise<ResolvedGrantee | null> {
  const raw = handle.trim();
  const store = getPlatformStore();

  const orgTeam = ORG_TEAM.exec(raw);
  if (orgTeam) {
    const org = await store.orgs.getOrgBySlug(orgTeam[1]);
    if (!org) return null;
    const team = await store.teams.getTeamBySlug(org.id, orgTeam[2]);
    return team ? { granteeType: "team", granteeId: team.id } : null;
  }

  const single = LOGIN.exec(raw);
  if (!single) return null;

  // A bare `@name` is ambiguous between a user handle and an org slug. Users
  // are checked first because `github_login` is the handle a person types for
  // themselves; an org slug that collides with a login is reachable as itself
  // only if no user holds that login. Both are exact matches either way.
  //
  // `getUserByGithubLogin` is synchronous (AuthRepository: AdapterUser | null).
  // Do not await it: a Promise is always truthy, which would treat every
  // `@login` as a hit even on a miss. `setGithubLogin` is the async sibling.
  const user = store.auth.getUserByGithubLogin(single[1]);
  if (user) return { granteeType: "user", granteeId: user.id };

  const org = await store.orgs.getOrgBySlug(single[1]);
  return org ? { granteeType: "org", granteeId: org.id } : null;
}
