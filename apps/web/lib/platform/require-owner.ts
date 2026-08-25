import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { OrgRole } from "./orgs-store";
import type { GranteeIdentity, ShareRole } from "./project-shares-store";
import { getPlatformStore } from "./store";

/** Persistence writes are chatty (live-session patches). Isolated namespace. */
export const PROJECT_MUTATION_GUARD = {
  maxRequests: 120,
  windowMs: 60_000,
  keyPrefix: "projects",
} as const;

/**
 * Org administration is low-volume and human-paced (P-A2): its own namespace
 * so a burst of team edits cannot exhaust the chatty project-write budget.
 */
export const ORG_MUTATION_GUARD = {
  maxRequests: 30,
  windowMs: 60_000,
  keyPrefix: "orgs",
} as const;

export type OwnerResolution =
  | { ok: true; ownerId: string }
  | { ok: false; response: NextResponse };

/**
 * Persistence APIs require a JWT `sub`. Generate routes stay ungated
 * (quota-D2). Unsigned browsers keep origin-private IDB via the cache adapter.
 */
export async function requirePersistenceOwner(
  request: NextRequest,
): Promise<OwnerResolution> {
  const token = await getToken({ req: request });
  const sub = typeof token?.sub === "string" ? token.sub.trim() : "";
  if (!sub) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "unauthorized",
          message: "Sign in required",
          statusCode: 401,
        },
        { status: 401 },
      ),
    };
  }
  return { ok: true, ownerId: sub };
}

/**
 * How the caller relates to the tenant whose data they asked for. `self` is a
 * personal tenant (`tenantId === sub`); otherwise it is the caller's org role.
 */
export type TenantAccess = "self" | OrgRole;

export type TenantResolution =
  | { ok: true; tenantId: string; userId: string; access: TenantAccess }
  | { ok: false; response: NextResponse };

/** Membership lookup, injectable so the guard is testable without a database. */
export interface TenantMembershipReader {
  memberRole(orgId: string, userId: string): Promise<OrgRole | null>;
}

/**
 * H1.2 — may this caller act as `tenantId`?
 *
 * 401 without a JWT `sub`; 403 unless the tenant IS the caller, or the caller
 * holds an `org_members` row for it.
 *
 * Membership is read from the database on EVERY request, and no org claim is
 * ever written into the JWT. That is deliberate: a claim would keep a removed
 * member authorised until their token expired. The cost is one primary-key
 * lookup; the benefit is that removal takes effect on the very next request.
 *
 * A 403 here means "you are not a member of this tenant". It deliberately does
 * not reveal whether the tenant exists, and callers must not downgrade it to a
 * 404 — that would turn the guard into an existence oracle (D-A4).
 */
export async function requireTenant(
  request: NextRequest,
  tenantId: string,
  orgs?: TenantMembershipReader,
): Promise<TenantResolution> {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner;

  const userId = owner.ownerId;
  const tenant = tenantId.trim();
  if (!tenant) return { ok: false, response: tenantForbidden() };
  if (tenant === userId) {
    return { ok: true, tenantId: tenant, userId, access: "self" };
  }

  // Default arg evaluation would open the store before the 401 / self
  // branches; resolve membership only when this request needs it.
  const membershipReader = orgs ?? getPlatformStore().orgs;
  const role = await membershipReader.memberRole(tenant, userId);
  if (!role) return { ok: false, response: tenantForbidden() };
  return { ok: true, tenantId: tenant, userId, access: role };
}

/** What the caller may do with one project. `owner` is not a grant (D-A2). */
export type ProjectRole = "owner" | "write" | "read";

export type ProjectAccessResolution =
  | { ok: true; role: ProjectRole; ownerId: string; actorUserId: string }
  | { ok: false; response: NextResponse };

/** The two lookups access resolution needs, injectable for tests. */
export interface ProjectAccessReaders {
  memberRole(orgId: string, userId: string): Promise<OrgRole | null>;
  listOrgIdsForUser(userId: string): Promise<string[]>;
  listTeamIdsForUser(userId: string): Promise<string[]>;
  accessFor(
    ownerId: string,
    projectId: string,
    identity: GranteeIdentity,
  ): Promise<ShareRole | null>;
}

/**
 * P-A3 — may this caller reach `(ownerId, projectId)`, and as what?
 *
 * Resolved ONCE per request into a role; the caller then builds the ordinary
 * owner-scoped store for `ownerId`. This is the design rule that keeps the
 * seam intact: `saved-projects-store`'s statements stay `WHERE owner_id = ?`
 * and never learn about grants. What changed is who may ask.
 *
 * Decision order, first match wins:
 *   1. the caller IS the owner tenant — their own `sub`, or an `org_members`
 *      row when `ownerId` is an org  → `owner`
 *   2. a LIVE grant reaching them directly, through one of their orgs, or
 *      through one of their teams   → that grant's role (strongest wins)
 *   3. otherwise                     → 403
 *
 * The 403 is deliberately indistinguishable from the one for a project that
 * does not exist. Returning 404 for "no such project" and 403 for "exists but
 * forbidden" would turn this into an existence oracle across tenants (D-A4).
 * The cost is that a genuine typo also reads as 403; that is the right trade
 * for a cross-tenant surface.
 *
 * Grants are read per request and never cached in the JWT, so a revocation
 * takes effect on the very next call — same rule as `requireTenant`.
 */
export async function resolveProjectAccess(
  request: NextRequest,
  ownerId: string,
  projectId: string,
  readers?: ProjectAccessReaders,
): Promise<ProjectAccessResolution> {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner;

  const actorUserId = owner.ownerId;
  const tenant = ownerId.trim();
  const project = projectId.trim();
  if (!tenant || !project) {
    return { ok: false, response: projectForbidden() };
  }

  if (tenant === actorUserId) {
    return { ok: true, role: "owner", ownerId: tenant, actorUserId };
  }

  // An org tenant: membership makes the caller an owner of its projects. Org
  // ROLE (owner vs member) gates org administration, not project data — H1.3
  // gives members full project read/write inside their org.
  // Resolved AFTER the 401 and the personal-tenant short-circuit: a default
  // parameter evaluates at call time, which opened the platform store for
  // every request, including unauthenticated ones (review flag on #652).
  const r = readers ?? defaultProjectAccessReaders();
  const orgRole = await r.memberRole(tenant, actorUserId);
  if (orgRole) {
    return { ok: true, role: "owner", ownerId: tenant, actorUserId };
  }

  const [orgIds, teamIds] = await Promise.all([
    r.listOrgIdsForUser(actorUserId),
    r.listTeamIdsForUser(actorUserId),
  ]);
  const granted = await r.accessFor(tenant, project, {
    userId: actorUserId,
    orgIds,
    teamIds,
  });
  if (granted) {
    return { ok: true, role: granted, ownerId: tenant, actorUserId };
  }

  return { ok: false, response: projectForbidden() };
}

function defaultProjectAccessReaders(): ProjectAccessReaders {
  const store = getPlatformStore();
  return {
    memberRole: (orgId, userId) => store.orgs.memberRole(orgId, userId),
    listOrgIdsForUser: (userId) => store.orgs.listOrgIdsForUser(userId),
    listTeamIdsForUser: (userId) => store.teams.listTeamIdsForUser(userId),
    accessFor: (ownerId, projectId, identity) =>
      store.shares.accessFor(ownerId, projectId, identity),
  };
}

function projectForbidden(): NextResponse {
  return NextResponse.json(
    {
      error: "forbidden",
      message: "You do not have access to this project",
      statusCode: 403,
    },
    { status: 403 },
  );
}

function tenantForbidden(): NextResponse {
  return NextResponse.json(
    {
      error: "forbidden",
      message: "You do not have access to this tenant",
      statusCode: 403,
    },
    { status: 403 },
  );
}
