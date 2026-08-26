import { NextRequest } from "next/server";
import {
  handleProjectCreate,
  handleProjectList,
} from "../../../../lib/project-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tenant-addressed project creation (D-A8).
 *
 * The owner is in the URL, so a project can be created under an ORG rather
 * than under the caller's personal tenant. Without this shape an org could own
 * a project in principle — `owner_id` accepts an org UUID and
 * `resolveProjectAccess` grants on membership — but nothing could ever put one
 * there.
 *
 * No handler logic lives here. `POST /api/projects` (the personal alias) calls
 * the same module, so the two addresses cannot drift apart in what they
 * permit.
 */
/**
 * Tenant-addressed project listing (P-U5). Without this the collection route
 * was create-only: an org member could put a project into the org and then
 * never see it again. Same shared handler pattern as POST — the personal
 * alias (`GET /api/projects`) calls the same module, so the two addresses
 * cannot drift apart in what they permit.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ownerId: string }> },
) {
  const { ownerId } = await params;
  return handleProjectList(request, ownerId);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ownerId: string }> },
) {
  const { ownerId } = await params;
  return handleProjectCreate(request, ownerId);
}
