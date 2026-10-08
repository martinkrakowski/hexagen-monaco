import { NextRequest } from "next/server";
import {
  handleDocumentDelete,
  handleDocumentGet,
  handleDocumentPut,
} from "../../../../../../lib/document-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The author of every document is the signed-in user (`tenant.userId` from
 * `requireTenant`), never part of the URL. `kind` and `id` address the
 * document; they are not authorship claims.
 */
export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ ownerId: string; kind: string; id: string }> },
) {
  const { ownerId, kind, id } = await params;
  return handleDocumentGet(request, ownerId, kind, id);
}

export async function PUT(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ ownerId: string; kind: string; id: string }> },
) {
  const { ownerId, kind, id } = await params;
  return handleDocumentPut(request, ownerId, kind, id);
}

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ ownerId: string; kind: string; id: string }> },
) {
  const { ownerId, kind, id } = await params;
  return handleDocumentDelete(request, ownerId, kind, id);
}
