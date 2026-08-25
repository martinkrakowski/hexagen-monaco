import { NextRequest, NextResponse } from "next/server";
import { guardMutation, readJsonBody } from "../../lib/request-guards";
import { getPlatformStore } from "../../../lib/platform";
import { DuplicateOrgSlugError } from "../../../lib/platform/orgs-store";
import {
  ORG_MUTATION_GUARD,
  requirePersistenceOwner,
} from "../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The orgs this caller belongs to, with their role.
 *
 * H1.5 needs this and the plan did not name it: a tenant switcher cannot be
 * built without a list of tenants, and P-A2 added only per-org routes
 * (`/api/orgs/[orgId]/teams`). Listing is scoped to the caller's own
 * memberships — it is not a directory, and it answers nothing about orgs the
 * caller is not in (D-A4: no enumeration).
 */
export async function GET(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  const orgs = await getPlatformStore().orgs.listOrgsForUser(owner.ownerId);
  return NextResponse.json({ orgs });
}

/**
 * Org creation (H1.1).
 *
 * Without this route the whole org half of the model is unreachable: the
 * storage and authorization layers accept an org as a project owner, but
 * nothing could ever produce one.
 *
 * Any signed-in user may create an org and becomes its `owner`. That pairing
 * is atomic in the store — an org whose owner insert failed is administerable
 * by nobody and refused by `requireTenant` for everybody.
 */

/**
 * Slugs are share-handle material: `@org-slug` and `@org-slug/team-slug`.
 * A slug containing `/` or `@` would make those handles ambiguous, so the
 * pattern admits only lowercase letters, digits and inner hyphens.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

export async function POST(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  const gate = guardMutation(request, ORG_MUTATION_GUARD);
  if (gate) return gate;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { slug?: unknown; name?: unknown };
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!SLUG_PATTERN.test(slug) || !name) {
    return NextResponse.json(
      {
        error: "validation",
        message:
          "An org needs a name and a lowercase slug (letters, digits, hyphens).",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  try {
    const org = await getPlatformStore().orgs.createOrgWithOwner(
      { slug, name, createdBy: owner.ownerId },
      { actorId: owner.ownerId },
    );
    return NextResponse.json({ org }, { status: 201 });
  } catch (err) {
    // The unique index is the authority, not a pre-check: a SELECT-then-INSERT
    // loses the race between two concurrent creates of the same slug.
    if (err instanceof DuplicateOrgSlugError) {
      return NextResponse.json(
        {
          error: "conflict",
          message: `Org slug '${slug}' is already taken.`,
          statusCode: 409,
        },
        { status: 409 },
      );
    }
    throw err;
  }
}
