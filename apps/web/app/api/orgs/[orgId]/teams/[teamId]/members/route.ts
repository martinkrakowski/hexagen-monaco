import { NextRequest, NextResponse } from "next/server";
import {
  guardMutation,
  readJsonBody,
} from "../../../../../../lib/request-guards";
import { getPlatformStore } from "../../../../../../../lib/platform";
import {
  NotAnOrgMemberError,
  UnknownTeamError,
} from "../../../../../../../lib/platform/teams-store";
import {
  ORG_MUTATION_GUARD,
  requireTenant,
} from "../../../../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team membership (P-A2). Owner-only, like the rest of team management.
 *
 * The org-membership rule is enforced in the STORE, not here: this route
 * translates `NotAnOrgMemberError` into 409 rather than re-deriving the
 * check, so a second caller cannot bypass it by not knowing about it.
 */

function requireOwnerRole(access: string): NextResponse | null {
  if (access === "owner") return null;
  return NextResponse.json(
    {
      error: "forbidden",
      message: "Managing team membership requires the org owner role.",
      statusCode: 403,
    },
    { status: 403 },
  );
}

async function resolveTeam(orgId: string, teamId: string) {
  const team = await getPlatformStore().teams.getTeam(teamId);
  // Tenant-scoped: a team id belonging to another org is not reachable by
  // presenting this org's id.
  return team && team.orgId === orgId ? team : null;
}

function unknownTeam(): NextResponse {
  return NextResponse.json(
    { error: "not_found", message: "Unknown team.", statusCode: 404 },
    { status: 404 },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; teamId: string }> },
) {
  const { orgId, teamId } = await params;
  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;
  const roleGate = requireOwnerRole(tenant.access);
  if (roleGate) return roleGate;

  const gate = guardMutation(request, ORG_MUTATION_GUARD);
  if (gate) return gate;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { userId?: unknown };
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return NextResponse.json(
      { error: "validation", message: "userId is required.", statusCode: 400 },
      { status: 400 },
    );
  }

  if (!(await resolveTeam(orgId, teamId))) return unknownTeam();

  const store = getPlatformStore();
  try {
    // Audit row written inside the same transaction as the membership insert.
    await store.teams.addMember(teamId, userId, { actorId: tenant.userId });
  } catch (err) {
    if (err instanceof NotAnOrgMemberError) {
      return NextResponse.json(
        {
          error: "conflict",
          message:
            "That user is not a member of this org, so they cannot join its teams.",
          statusCode: 409,
        },
        { status: 409 },
      );
    }
    if (err instanceof UnknownTeamError) return unknownTeam();
    throw err;
  }

  return NextResponse.json({ teamId, userId }, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; teamId: string }> },
) {
  const { orgId, teamId } = await params;
  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;
  const roleGate = requireOwnerRole(tenant.access);
  if (roleGate) return roleGate;

  const gate = guardMutation(request, ORG_MUTATION_GUARD);
  if (gate) return gate;

  const userId = request.nextUrl.searchParams.get("userId")?.trim() ?? "";
  if (!userId) {
    return NextResponse.json(
      { error: "validation", message: "userId is required.", statusCode: 400 },
      { status: 400 },
    );
  }

  if (!(await resolveTeam(orgId, teamId))) return unknownTeam();

  const store = getPlatformStore();
  // Audit row written inside the same transaction as the deletion.
  await store.teams.removeMember(teamId, userId, { actorId: tenant.userId });
  return new NextResponse(null, { status: 204 });
}
