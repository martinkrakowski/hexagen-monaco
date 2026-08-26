import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "../../../lib/request-guards";
import { getPlatformStore } from "../../../../lib/platform";
import { requirePersistenceOwner } from "../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Onboarding completion (P-U0b / D-U5).
 *
 * Server-side, not localStorage: the flag must survive devices and browsers,
 * and "has an org" is a wrong proxy — a personal-tenant user would be
 * re-onboarded forever. Skipping the wizard counts as completing it (D-U4):
 * onboarding must never become a wall in front of a working personal tenant,
 * so both "Done" and "Skip" land here.
 */

/**
 * Onboarding completion is a couple of human-paced calls per account,
 * lifetime. Its own namespace so it never shares a budget with the chatty
 * project writes or the org-admin family.
 */
const ACCOUNT_MUTATION_GUARD = {
  maxRequests: 30,
  windowMs: 60_000,
  keyPrefix: "account",
} as const;

export async function GET(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  const onboardedAt = await getPlatformStore().auth.getOnboardedAt(
    owner.ownerId,
  );
  return NextResponse.json({ onboardedAt });
}

/**
 * Mark onboarding complete. 200 with the timestamp — the ORIGINAL one when
 * already complete: `markOnboarded` is idempotent at the SQL level
 * (`... AND onboarded_at IS NULL`), so a replay (double-click, refreshed
 * final step) never advances the stamp, and the read-back below returns
 * whatever the first completion wrote.
 */
export async function POST(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  // Keyed PER OWNER, not per IP: behind a shared NAT one retrying client
  // could otherwise exhaust the whole budget and 429 another account's
  // onboarding completion (review flag on #663). The owner is already
  // resolved above, so the key is free.
  const gate = guardMutation(request, {
    ...ACCOUNT_MUTATION_GUARD,
    keyPrefix: `${ACCOUNT_MUTATION_GUARD.keyPrefix}:${owner.ownerId}`,
  });
  if (gate) return gate;

  const auth = getPlatformStore().auth;
  await auth.markOnboarded(owner.ownerId);
  const onboardedAt = await auth.getOnboardedAt(owner.ownerId);
  return NextResponse.json({ onboardedAt });
}
