import { NextRequest, NextResponse } from "next/server";
import { getPlatformStore } from "../../../lib/platform";
import { requirePersistenceOwner } from "../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The orgs this caller belongs to, with their role.
 *
 * H1.5 needs this and the plan did not name it: a tenant switcher cannot be
 * built without a list of tenants, and P-A2 added only per-org routes
 * (`/api/orgs/[orgId]/teams`). Listing is scoped to the caller's own
 * memberships — it is not a directory, and it answers nothing about orgs the
 * caller is not in (D-A4: no enumeration).
 */
export async function GET(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  const orgs = await getPlatformStore().orgs.listOrgsForUser(owner.ownerId);
  return NextResponse.json({ orgs });
}
