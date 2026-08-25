import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "../../../lib/request-guards";
import { getPlatformStore } from "../../../../lib/platform";
import { OrgOwnsProjectsError } from "../../../../lib/platform/orgs-store";
import {
  ORG_MUTATION_GUARD,
  requireTenant,
} from "../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Org deletion (tenancy hygiene).
 *
 * Owner-only, and REFUSED while the org owns projects (409 with the count):
 * deleting customer data must be an explicit act — empty the org first —
 * never a cascade surprise. With zero projects the store removes teams,
 * memberships, pending invites, soft-revokes every grant where the org or
 * one of its teams is the grantee, and drops the org row — all in one
 * transaction, with the `org.delete` audit row inside it.
 *
 * Grants where the org is the project OWNER cannot exist at deletion time,
 * because the org owns zero projects by then — asserted in the store's test,
 * not just claimed here.
 *
 * A nonexistent org is unreachable: with no org row there are no membership
 * rows, so `requireTenant` answers 403 (which deliberately does not reveal
 * whether the org exists, D-A4). The same applies to a second delete.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;
  if (tenant.access !== "owner") {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "Deleting an org requires the org owner role.",
        statusCode: 403,
      },
      { status: 403 },
    );
  }

  const gate = guardMutation(request, ORG_MUTATION_GUARD);
  if (gate) return gate;

  try {
    await getPlatformStore().orgs.deleteOrg(orgId, {
      actorId: tenant.userId,
    });
  } catch (error) {
    if (error instanceof OrgOwnsProjectsError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          projectCount: error.projectCount,
          statusCode: 409,
        },
        { status: 409 },
      );
    }
    // Unknown errors propagate: the outer 500 must not swallow a defect as a
    // polite response (same idiom as every sibling route).
    throw error;
  }

  return new NextResponse(null, { status: 204 });
}
