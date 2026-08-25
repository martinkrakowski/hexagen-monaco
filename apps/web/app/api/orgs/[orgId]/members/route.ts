import { NextRequest, NextResponse } from "next/server";
import { guardMutation, readJsonBody } from "../../../../lib/request-guards";
import { getPlatformStore } from "../../../../../lib/platform";
import {
  LastOwnerError,
  type OrgRole,
} from "../../../../../lib/platform/orgs-store";
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
  const body = parsed.body as { githubLogin?: unknown; role?: unknown };

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
  const existing = store.auth.getUserByGithubLogin(githubLogin);

  try {
    if (existing) {
      // Audit row written inside the same transaction as the membership write.
      await store.orgs.addMember(orgId, existing.id, role as OrgRole, {
        actorId: tenant.userId,
      });
      return NextResponse.json(
        { member: { userId: existing.id, role } },
        { status: 201 },
      );
    }

    const invite = await store.orgs.invite(
      orgId,
      githubLogin,
      role as OrgRole,
      {
        actorId: tenant.userId,
      },
    );
    // 202, not 201: nothing was created that the client can now address. The
    // membership does not exist and will not until that person signs in, so a
    // UI that renders a 201 as "added" would be lying. The distinct status is
    // what lets it say "invited" instead.
    //
    // This DOES tell an org owner whether a handle has signed in here before,
    // and that is a deliberate reading of D-A4: the rule forbids DISCOVERY —
    // search, prefixes, enumerating who exists — by anyone who cares to ask.
    // This is an exact-handle action by an authenticated owner who learns the
    // same fact from the very next read of their own member list, and the
    // shape of a REFUSAL is unchanged either way.
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
  } catch (err) {
    if (err instanceof LastOwnerError) {
      return NextResponse.json(
        {
          error: "conflict",
          message:
            "This org would be left with no owner. Promote another owner first.",
          statusCode: 409,
        },
        { status: 409 },
      );
    }
    throw err;
  }
}
