import { NextRequest } from "next/server";
import { requirePersistenceOwner } from "../../../../lib/platform/require-owner";
import {
  handleProjectDelete,
  handleProjectGet,
  handleProjectPut,
} from "../../../lib/project-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The personal-tenant alias (D-A8). `/api/tenants/[ownerId]/projects/[id]` is
 * the general form; this one exists so existing clients and tests keep
 * working, and it simply addresses the caller's own tenant.
 *
 * It resolves the caller's `sub` and delegates to the SAME handlers, which
 * re-resolve access. `resolveProjectAccess` short-circuits to `owner` when the
 * tenant is the caller, so the extra call is one comparison — cheaper than a
 * second authorization path that could drift from the first.
 */
async function ownTenant(
  request: NextRequest,
): Promise<{ ok: true; ownerId: string } | { ok: false; response: Response }> {
  const owner = await requirePersistenceOwner(request);
  return owner.ok
    ? { ok: true, ownerId: owner.ownerId }
    : { ok: false, response: owner.response };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const owner = await ownTenant(request);
  if (!owner.ok) return owner.response;
  const { projectId } = await params;
  return handleProjectGet(request, owner.ownerId, projectId);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const owner = await ownTenant(request);
  if (!owner.ok) return owner.response;
  const { projectId } = await params;
  return handleProjectPut(request, owner.ownerId, projectId);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const owner = await ownTenant(request);
  if (!owner.ok) return owner.response;
  const { projectId } = await params;
  return handleProjectDelete(request, owner.ownerId, projectId);
}
