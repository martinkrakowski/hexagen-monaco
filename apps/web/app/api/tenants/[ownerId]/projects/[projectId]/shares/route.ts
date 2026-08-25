import { NextRequest } from "next/server";
import {
  handleShareCreate,
  handleSharesList,
} from "../../../../../../lib/share-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shares on one project (P-A4). Owner-role only, enforced in the handler.
 *
 * Only the tenant-addressed shape exists: a share is an act on a specific
 * tenant's project, so there is no personal alias to keep it symmetrical with.
 */

type Params = { params: Promise<{ ownerId: string; projectId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { ownerId, projectId } = await params;
  return handleSharesList(request, ownerId, projectId);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { ownerId, projectId } = await params;
  return handleShareCreate(request, ownerId, projectId);
}
