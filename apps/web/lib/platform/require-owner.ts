import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { OrgRole } from "./orgs-store";
import { getPlatformStore } from "./store";

/** Persistence writes are chatty (live-session patches). Isolated namespace. */
export const PROJECT_MUTATION_GUARD = {
  maxRequests: 120,
  windowMs: 60_000,
  keyPrefix: "projects",
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
