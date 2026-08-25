import { NextRequest, NextResponse } from "next/server";
import { getPlatformStore } from "../../../../lib/platform";
import { requirePersistenceOwner } from "../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shared-with-me (P-A4) — `selectSharedWith`'s first consumer.
 *
 * Lists every LIVE grant reaching the caller, directly or through one of their
 * orgs or teams. Revoked grants are excluded by the store, not filtered here:
 * one place decides what "live" means (D-A5).
 *
 * Each row carries the project's real `ownerId` and the caller's role, which
 * is what the client needs to address the tenant route and to decide whether
 * to render a read-only editor (P-A5).
 */

export async function GET(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  const store = getPlatformStore();
  const userId = owner.ownerId;
  const [orgIds, teamIds] = await Promise.all([
    store.orgs.listOrgIdsForUser(userId),
    store.teams.listTeamIdsForUser(userId),
  ]);

  const grants = await store.shares.selectSharedWith({
    userId,
    orgIds,
    teamIds,
  });
  return NextResponse.json({ shared: grants });
}
