import { NextRequest, NextResponse } from "next/server";
import { guardMutation, readJsonBody } from "../../../../lib/request-guards";
import { getPlatformStore } from "../../../../../lib/platform";
import { DuplicateTeamSlugError } from "../../../../../lib/platform/teams-store";
import {
  ORG_MUTATION_GUARD,
  requireTenant,
} from "../../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team management inside an org (P-A2).
 *
 * `requireTenant`'s first real consumer: it answers "may this caller act as
 * this org", and the `access` it returns carries the role. Managing teams is
 * `owner`-only (H1.3/D-A2); a `member` may be IN a team but not create or
 * delete one. A caller who is neither gets 403 from `requireTenant` itself,
 * which deliberately does not reveal whether the org exists (D-A4).
 */

/** Slugs are share-handle material (`@org-slug/team-slug`) — keep them URL-safe. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

function forbiddenForRole(): NextResponse {
  return NextResponse.json(
    {
      error: "forbidden",
      message: "Managing teams requires the org owner role.",
      statusCode: 403,
    },
    { status: 403 },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;

  const teams = await getPlatformStore().teams.listTeamsForOrg(orgId);
  return NextResponse.json({ teams });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const tenant = await requireTenant(request, orgId);
  if (!tenant.ok) return tenant.response;
  if (tenant.access !== "owner") return forbiddenForRole();

  const gate = guardMutation(request, ORG_MUTATION_GUARD);
  if (gate) return gate;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body as { slug?: unknown; name?: unknown };
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!SLUG_PATTERN.test(slug) || !name) {
    return NextResponse.json(
      {
        error: "validation",
        message:
          "A team needs a name and a lowercase slug (letters, digits, hyphens).",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const store = getPlatformStore();
  // No read-then-write pre-check: two concurrent creates both pass it and the
  // loser escapes as a 500. The UNIQUE index decides, and the store turns its
  // verdict into DuplicateTeamSlugError.
  let team;
  try {
    team = await store.teams.createTeam(
      { orgId, slug, name, createdBy: tenant.userId },
      // The audit row is written in the SAME transaction as the insert.
      { actorId: tenant.userId },
    );
  } catch (err) {
    if (err instanceof DuplicateTeamSlugError) {
      return NextResponse.json(
        {
          error: "conflict",
          message: `Team slug '${slug}' already exists in this org.`,
          statusCode: 409,
        },
        { status: 409 },
      );
    }
    throw err;
  }
  return NextResponse.json({ team }, { status: 201 });
}
