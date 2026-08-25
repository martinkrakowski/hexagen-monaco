import { NextRequest, NextResponse } from "next/server";
import { guardMutation, readJsonBody } from "../../../../../lib/request-guards";
import { getPlatformStore } from "../../../../../../lib/platform";
import { LastOwnerError } from "../../../../../../lib/platform/orgs-store";
import {
  ORG_MUTATION_GUARD,
  requireTenant,
} from "../../../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Removing an org member (H1.2), and leaving an org yourself.
 *
 * TWO callers, ONE removal. Owners may remove anybody; anybody may remove
 * THEMSELVES. Both go through `orgs-store.removeMember`, which drops the
 * membership and the user's team rows in this org in a single transaction
 * (P-A2) and writes the audit entry inside it. A separate "leave" endpoint
 * would be a second removal path, and the one that forgets the team cascade
 * leaves live grants nobody can see from the org page.
 *
 * The last-owner refusal applies identically to both: a sole owner cannot
 * leave any more than they can be removed. It is enforced in the store and
 * mapped to 409 here.
 */

function authorizeRemoval(
  access: string,
  callerId: string,
  targetId: string,
): NextResponse | null {
  // Self-removal needs no role. A `member` has no other way out of an org --
  // only an owner can remove people -- so without this the exit depends on
  // someone else's cooperation.
  if (callerId === targetId) return null;
  if (access === "owner") return null;
  return NextResponse.json(
    {
      error: "forbidden",
      message:
        "Removing another member requires the org owner role. You may always remove yourself.",
      statusCode: 403,
    },
    { status: 403 },
  );
}

/**
 * PATCH — change an existing member's role. By USER ID, deliberately: the
 * POST route addresses people by GitHub handle, which is mutable and
 * recyclable and therefore only provably owned at OAuth sign-in (see the
 * always-invite rationale there). A member's userId is immutable, so a role
 * change addressed to it cannot land on the wrong person. Owner role only;
 * demoting the last owner is the same typed 409 as removing them.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ orgId: string; userId: string }> },
): Promise<NextResponse> {
  const { orgId, userId } = await context.params;
  const gate = guardMutation(request, ORG_MUTATION_GUARD);
  if (gate) return gate;

  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;
  if (tenant.access !== "owner") {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "Changing a member's role requires the org owner role.",
        statusCode: 403,
      },
      { status: 403 },
    );
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { role?: unknown };
  if (body.role !== "owner" && body.role !== "member") {
    return NextResponse.json(
      {
        error: "validation",
        message: 'role must be "owner" or "member"',
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const store = getPlatformStore();
  if (!(await store.orgs.memberRole(orgId, userId))) {
    return NextResponse.json(
      { error: "not_found", message: "No such member", statusCode: 404 },
      { status: 404 },
    );
  }

  try {
    await store.orgs.addMember(orgId, userId, body.role, {
      actorId: tenant.userId,
    });
    return NextResponse.json({ member: { userId, role: body.role } });
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const { orgId, userId } = await params;
  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;

  const target = userId.trim();
  if (!target) {
    return NextResponse.json(
      { error: "validation", message: "userId is required.", statusCode: 400 },
      { status: 400 },
    );
  }

  const roleGate = authorizeRemoval(tenant.access, tenant.userId, target);
  if (roleGate) return roleGate;

  const gate = guardMutation(request, ORG_MUTATION_GUARD);
  if (gate) return gate;

  const store = getPlatformStore();
  try {
    // Audit row written inside the same transaction as the deletion, and the
    // team-membership cascade with it.
    await store.orgs.removeMember(orgId, target, { actorId: tenant.userId });
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

  return new NextResponse(null, { status: 204 });
}
