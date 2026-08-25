import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "../../../../../lib/request-guards";
import { getPlatformStore } from "../../../../../../lib/platform";
import {
  ORG_MUTATION_GUARD,
  requireTenant,
} from "../../../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deleting a team is owner-only (P-A2). Its memberships go with it. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; teamId: string }> },
) {
  const { orgId, teamId } = await params;
  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;
  if (tenant.access !== "owner") {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "Managing teams requires the org owner role.",
        statusCode: 403,
      },
      { status: 403 },
    );
  }

  const gate = guardMutation(request, ORG_MUTATION_GUARD);
  if (gate) return gate;

  const store = getPlatformStore();
  const team = await store.teams.getTeam(teamId);
  // Scoped to the tenant: a team id from another org must not be reachable by
  // presenting this org's id.
  if (!team || team.orgId !== orgId) {
    return NextResponse.json(
      { error: "not_found", message: "Unknown team.", statusCode: 404 },
      { status: 404 },
    );
  }

  await store.teams.deleteTeam(teamId);
  await store.audit.append({
    actorId: tenant.userId,
    action: "team.delete",
    subjectOwnerId: orgId,
    subjectId: teamId,
  });
  return new NextResponse(null, { status: 204 });
}
