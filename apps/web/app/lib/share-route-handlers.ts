import { NextRequest, NextResponse } from "next/server";
import { projectIdSchema } from "./schemas/project-id-schema";
import { guardMutation, readJsonBody } from "./request-guards";
import { resolveShareHandle, type ResolvedGrantee } from "./share-handles";
import { getPlatformStore } from "../../lib/platform";
import {
  PROJECT_MUTATION_GUARD,
  requirePersistenceOwner,
  resolveProjectAccess,
} from "../../lib/platform/require-owner";
import type {
  GranteeType,
  ShareRole,
} from "../../lib/platform/project-shares-store";

/**
 * Share and revoke (P-A4).
 *
 * Owner-role only, both directions. A `write` grantee may edit the project it
 * was lent but may not lend it onward: re-sharing is an ownership act, and a
 * grant that can mint further grants is a privilege-escalation path with no
 * owner in the loop.
 */

const GRANTEE_TYPES: readonly string[] = ["user", "org", "team"];
const ROLES: readonly string[] = ["read", "write"];

function invalidId(): NextResponse {
  return NextResponse.json(
    {
      error: "validation",
      message: "Invalid project ID format",
      statusCode: 400,
    },
    { status: 400 },
  );
}

function validation(message: string): NextResponse {
  return NextResponse.json(
    { error: "validation", message, statusCode: 400 },
    { status: 400 },
  );
}

function ownerOnly(): NextResponse {
  return NextResponse.json(
    {
      error: "forbidden",
      message: "Only the project owner may change its shares",
      statusCode: 403,
    },
    { status: 403 },
  );
}

/**
 * The ONE 404 every unresolvable grantee gets (D-A4).
 *
 * Used for a handle that matches nothing AND for a handle whose shape is
 * wrong. The body is identical in both cases and says nothing about which
 * kind of thing was missing, so a caller cannot use this endpoint to discover
 * whether a login, org or team exists. Any future branch that returns a
 * *different* body here reopens the oracle.
 */
function granteeNotFound(): NextResponse {
  return NextResponse.json(
    { error: "not_found", message: "No such handle", statusCode: 404 },
    { status: 404 },
  );
}

/**
 * 404 is only reachable AFTER owner access, so it cannot probe another
 * tenant (same anti-enumeration rule as handleProjectGet).
 */
function projectNotFound(): NextResponse {
  return NextResponse.json(
    { error: "not_found", message: "Project not found", statusCode: 404 },
    { status: 404 },
  );
}

function persistenceError(kind: string, message: string): NextResponse {
  return NextResponse.json(
    { error: kind, message, statusCode: 500 },
    { status: 500 },
  );
}

function alreadyOwner(): NextResponse {
  return NextResponse.json(
    {
      error: "validation",
      message: "Cannot share a project with its owner",
      statusCode: 400,
    },
    { status: 400 },
  );
}

/**
 * Authenticate, then rate-limit. Reversing that lets unsigned traffic exhaust
 * the IP-keyed write budget (429) before `resolveProjectAccess` can 401.
 */
async function gateShareMutation(
  request: NextRequest,
): Promise<NextResponse | null> {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;
  return guardMutation(request, PROJECT_MUTATION_GUARD);
}

function requireExistingProject(
  ownerId: string,
  projectId: string,
): NextResponse | null {
  const found = getPlatformStore().projectsFor(ownerId).getProject(projectId);
  if (!found.success) {
    return persistenceError("persistence", found.error.message);
  }
  if (!found.value) return projectNotFound();
  return null;
}

/**
 * True when the resolved identity already has owner access through the
 * owning tenant — the personal user, the owning org, a member of that org,
 * or a team that belongs to that org.
 */
async function granteeAlreadyOwns(
  ownerId: string,
  resolved: ResolvedGrantee,
): Promise<boolean> {
  if (resolved.granteeId === ownerId) return true;
  const store = getPlatformStore();
  if (resolved.granteeType === "user") {
    const role = await store.orgs.memberRole(ownerId, resolved.granteeId);
    if (role) return true;
  }
  if (resolved.granteeType === "team") {
    const team = await store.teams.getTeam(resolved.granteeId);
    if (team?.orgId === ownerId) return true;
  }
  return false;
}

interface ShareBody {
  grantee?: unknown;
  role?: unknown;
}

export async function handleShareCreate(
  request: NextRequest,
  ownerId: string,
  projectId: string,
): Promise<NextResponse> {
  const gate = await gateShareMutation(request);
  if (gate) return gate;

  const parsedId = projectIdSchema.safeParse(projectId);
  if (!parsedId.success) return invalidId();

  const access = await resolveProjectAccess(request, ownerId, parsedId.data);
  if (!access.ok) return access.response;
  if (access.role !== "owner") return ownerOnly();

  const missing = requireExistingProject(access.ownerId, parsedId.data);
  if (missing) return missing;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const { grantee, role } = (body.body ?? {}) as ShareBody;

  if (typeof grantee !== "string" || grantee.trim() === "") {
    return validation("A grantee handle is required");
  }
  if (typeof role !== "string" || !ROLES.includes(role)) {
    return validation('Role must be "read" or "write"');
  }

  const resolved = await resolveShareHandle(grantee);
  if (!resolved) return granteeNotFound();
  if (await granteeAlreadyOwns(access.ownerId, resolved)) {
    return alreadyOwner();
  }

  const store = getPlatformStore();
  await store.shares.grant(
    {
      ownerId: access.ownerId,
      projectId: parsedId.data,
      granteeType: resolved.granteeType,
      granteeId: resolved.granteeId,
      role: role as ShareRole,
      grantedBy: access.actorUserId,
    },
    { actorId: access.actorUserId },
  );

  return NextResponse.json(
    {
      ownerId: access.ownerId,
      projectId: parsedId.data,
      granteeType: resolved.granteeType,
      granteeId: resolved.granteeId,
      role,
    },
    { status: 200 },
  );
}

export async function handleShareRevoke(
  request: NextRequest,
  ownerId: string,
  projectId: string,
  granteeType: string,
  granteeId: string,
): Promise<NextResponse> {
  const gate = await gateShareMutation(request);
  if (gate) return gate;

  const parsedId = projectIdSchema.safeParse(projectId);
  if (!parsedId.success) return invalidId();

  const access = await resolveProjectAccess(request, ownerId, parsedId.data);
  if (!access.ok) return access.response;
  if (access.role !== "owner") return ownerOnly();

  const missing = requireExistingProject(access.ownerId, parsedId.data);
  if (missing) return missing;

  if (!GRANTEE_TYPES.includes(granteeType) || granteeId.trim() === "") {
    // Same body as an unknown grantee: a malformed target must not be
    // distinguishable from an absent one.
    return granteeNotFound();
  }

  const store = getPlatformStore();
  // Revocation is idempotent (D-A5): the HTTP response is the same whether
  // or not a live grant existed. The audit row is written only when a live
  // grant actually changed (`changes > 0`), matching team membership.
  await store.shares.revoke(
    {
      ownerId: access.ownerId,
      projectId: parsedId.data,
      granteeType: granteeType as GranteeType,
      granteeId,
    },
    { actorId: access.actorUserId },
  );

  return NextResponse.json({ ok: true });
}

export async function handleSharesList(
  request: NextRequest,
  ownerId: string,
  projectId: string,
): Promise<NextResponse> {
  const parsedId = projectIdSchema.safeParse(projectId);
  if (!parsedId.success) return invalidId();

  const access = await resolveProjectAccess(request, ownerId, parsedId.data);
  if (!access.ok) return access.response;
  if (access.role !== "owner") return ownerOnly();

  const missing = requireExistingProject(access.ownerId, parsedId.data);
  if (missing) return missing;

  const shares = await getPlatformStore().shares.listForProject(
    access.ownerId,
    parsedId.data,
  );
  return NextResponse.json({ shares });
}
