import { NextRequest } from "next/server";
import {
  handleProjectDelete,
  handleProjectGet,
  handleProjectPut,
} from "../../../../../lib/project-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tenant-addressed project access (D-A8, P-A3).
 *
 * The owner is in the URL, so a grantee addresses the project's REAL owner
 * rather than their own tenant — which is what makes a shared project
 * reachable at all. Authorization is `resolveProjectAccess`: owner, or a live
 * grant reaching the caller directly / through an org / through a team.
 *
 * No handler logic lives here. It is the same module the personal alias uses,
 * so the two addresses cannot drift apart in what they permit.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ownerId: string; projectId: string }> },
) {
  const { ownerId, projectId } = await params;
  return handleProjectGet(request, ownerId, projectId);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ ownerId: string; projectId: string }> },
) {
  const { ownerId, projectId } = await params;
  return handleProjectPut(request, ownerId, projectId);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ownerId: string; projectId: string }> },
) {
  const { ownerId, projectId } = await params;
  return handleProjectDelete(request, ownerId, projectId);
}
