import { NextRequest, NextResponse } from "next/server";
import { guardMutation, readJsonBody } from "../../../../lib/request-guards";
import { getPlatformStore } from "../../../../../lib/platform";
import { type OrgRole } from "../../../../../lib/platform/orgs-store";
import {
  ORG_MUTATION_GUARD,
  requireTenant,
} from "../../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Org membership (H1.2). Owner-only.
 *
 * This route is the gap that leaves an org at one member forever: nothing else
 * in the codebase writes `org_members` after `createOrg`.
 *
 * D-A4 — NO DISCOVERY. The handle is matched EXACTLY against
 * `users.github_login`; there is no search, no prefix, no listing. What that
 * rule protects is the shape of REFUSALS: an unknown handle must be
 * indistinguishable from any other refusal, so an outsider cannot use this
 * endpoint to test whether a name has an account here. Note the consequence
 * for a *successful* call below (201 vs 202).
 */

function requireOwnerRole(access: string): NextResponse | null {
  if (access === "owner") return null;
  return NextResponse.json(
    {
      error: "forbidden",
      message: "Managing org membership requires the org owner role.",
      statusCode: 403,
    },
    { status: 403 },
  );
}

/**
 * GitHub logins: 1–39 chars of [A-Za-z0-9-], no leading/trailing or doubled
 * hyphen. Validated so that a handle which could never exist is rejected as
 * malformed rather than silently becoming a pending invite nobody can ever
 * accept — an invite row for `"'; DROP"` is not a security hole, but it is a
 * permanent piece of garbage in an owner's pending list.
 */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * Org roster (P-U0b): live members plus pending invites.
 *
 * ANY org member may read — seeing who shares your org is not an
 * administrative act, so unlike the mutations below there is no
 * `requireOwnerRole` gate. Outsiders still get `requireTenant`'s uniform 403,
 * which discloses nothing about whether the org exists (D-A4).
 *
 * `listPendingInvites` already excludes expired invites, so the response
 * never advertises a grant that can no longer be redeemed. Members and
 * invites are kept as separate arrays on purpose: an invite is NOT a
 * membership (nothing exists until the invitee's next sign-in), and a client
 * that merged them would be lying — see the 202 reasoning on POST below.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;

  const store = getPlatformStore();
  const [members, pending] = await Promise.all([
    store.orgs.listMembers(orgId),
    store.orgs.listPendingInvites(orgId),
  ]);
  // Explicit field mapping, not a pass-through: `OrgInvite` also carries
  // `acceptedAt`/`orgId`/`createdAt`, and future store fields must not leak
  // onto the wire by default.
  return NextResponse.json({
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt,
    })),
    pendingInvites: pending.map((invite) => ({
      githubLogin: invite.githubLogin,
      role: invite.role,
      expiresAt: invite.expiresAt,
      invitedBy: invite.invitedBy,
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;
  const roleGate = requireOwnerRole(tenant.access);
  if (roleGate) return roleGate;

  const gate = guardMutation(request, ORG_MUTATION_GUARD);
  if (gate) return gate;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  // JSON `null` is syntactically valid, so parsed.body can be null and a
  // property access would throw 500 instead of the intended 400 (review flag
  // on #657).
  const body = (parsed.body ?? {}) as { githubLogin?: unknown; role?: unknown };

  const githubLogin =
    typeof body.githubLogin === "string" ? body.githubLogin.trim() : "";
  if (!GITHUB_LOGIN.test(githubLogin)) {
    return NextResponse.json(
      {
        error: "validation",
        message: "githubLogin must be a valid GitHub username.",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  // H1.3/D-A2: exactly two roles. An unrecognised value is rejected here
  // rather than defaulted, because defaulting an unknown role to `member`
  // would silently under-grant and defaulting it to `owner` would silently
  // over-grant.
  const role = typeof body.role === "string" ? body.role : "";
  if (role !== "owner" && role !== "member") {
    return NextResponse.json(
      {
        error: "validation",
        message: "role must be 'owner' or 'member'.",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const store = getPlatformStore();

  // ALWAYS an invite, redeemed at the invitee's next sign-in — never a
  // direct add from the local handle cache (review flag on #657, replacing
  // the earlier 201 path). users.github_login refreshes only at sign-in,
  // and GitHub handles are mutable and recyclable: a renamed-then-recycled
  // handle would make a direct add grant membership to whichever LOCAL user
  // last held the name — the same hijack invite expiry closes, minus the
  // expiry. Handle ownership is only provably current at OAuth sign-in, so
  // sign-in is the only moment a handle may become a membership. This also
  // makes the response uniform: 202 for every target, disclosing nothing
  // about whether a handle has been seen here (resolving the D-A4 judgment
  // the earlier 201/202 split left open). An already-signed-in invitee can
  // force redemption by re-authenticating.
  const invite = await store.orgs.invite(orgId, githubLogin, role as OrgRole, {
    actorId: tenant.userId,
  });
  // 202: nothing addressable exists yet — the membership arrives when the
  // invitee next signs in.
  return NextResponse.json(
    {
      invite: {
        githubLogin: invite.githubLogin,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
    },
    { status: 202 },
  );
}
