import { NextRequest } from "next/server";
import { handleShareRevoke } from "../../../../../../../../lib/share-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revoke one grant (P-A4). Soft (`revoked_at`), owner-role only, idempotent. */

type Params = {
  params: Promise<{
    ownerId: string;
    projectId: string;
    granteeType: string;
    granteeId: string;
  }>;
};

export async function DELETE(request: NextRequest, { params }: Params) {
  const { ownerId, projectId, granteeType, granteeId } = await params;
  return handleShareRevoke(request, ownerId, projectId, granteeType, granteeId);
}
