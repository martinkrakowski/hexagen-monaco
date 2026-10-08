import { NextRequest } from "next/server";
import { handleDocumentList } from "../../../../lib/document-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The author of every document is the signed-in user (`tenant.userId` from
 * `requireTenant`), never part of the URL. `ownerId` is the tenant address —
 * a personal tenant id or an org id — checked by `requireTenant` before the
 * store is touched.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ownerId: string }> },
) {
  const { ownerId } = await params;
  return handleDocumentList(request, ownerId);
}
