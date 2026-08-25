import { NextRequest, NextResponse } from "next/server";
import { projectIdSchema } from "./schemas/project-id-schema";
import { guardMutation, readJsonBody } from "./request-guards";
import { getPlatformStore } from "../../lib/platform";
import { parseSavedProjectBody } from "../../lib/platform/saved-project-body";
import {
  PROJECT_MUTATION_GUARD,
  resolveProjectAccess,
  type ProjectRole,
} from "../../lib/platform/require-owner";

/**
 * One project's handlers, shared by both addressable routes (D-A8):
 *
 *   /api/projects/[projectId]                    personal-tenant alias
 *   /api/tenants/[ownerId]/projects/[projectId]  anything a grantee reaches
 *
 * They share an implementation on purpose. Two copies of an authorization
 * path is how one of them ends up with the weaker check — and here the weaker
 * check is cross-tenant project access.
 *
 * Every handler resolves access ONCE via `resolveProjectAccess` and then uses
 * the ordinary owner-scoped store for the project's real owner. The store's
 * statements never learn about grants (P-A3).
 */

function invalidId() {
  return NextResponse.json(
    {
      error: "validation",
      message: "Invalid project ID format",
      statusCode: 400,
    },
    { status: 400 },
  );
}

function notFound() {
  return NextResponse.json(
    { error: "not_found", message: "Project not found", statusCode: 404 },
    { status: 404 },
  );
}

/**
 * A 404 here is only ever reachable AFTER access has been granted, so it
 * cannot be used to probe another tenant: a caller with no access is refused
 * with 403 before any row is read (D-A4).
 */
function persistenceError(kind: string, message: string) {
  return NextResponse.json(
    { error: kind, message, statusCode: 500 },
    { status: 500 },
  );
}

function parseIfMatch(
  request: NextRequest,
): { ok: true; expected?: number } | { ok: false; response: NextResponse } {
  const raw = request.headers.get("If-Match");
  if (raw == null || raw === "" || raw === "*") return { ok: true };
  const trimmed = raw.trim().replace(/^W\//, "").replaceAll('"', "");
  const expected = Number(trimmed);
  if (!Number.isFinite(expected)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "validation",
          message: "Invalid If-Match precondition",
          statusCode: 400,
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, expected };
}

/** Roles that may write one project. A write grant is per-project (D-A2). */
const CAN_WRITE: readonly ProjectRole[] = ["owner", "write"];

function insufficientRole(): NextResponse {
  return NextResponse.json(
    {
      error: "forbidden",
      message: "Your access to this project is read-only",
      statusCode: 403,
    },
    { status: 403 },
  );
}

export async function handleProjectGet(
  request: NextRequest,
  ownerId: string,
  projectId: string,
): Promise<NextResponse> {
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) return invalidId();

  const access = await resolveProjectAccess(request, ownerId, parsed.data);
  if (!access.ok) return access.response;

  const found = getPlatformStore()
    .projectsFor(access.ownerId)
    .getProject(parsed.data);
  if (!found.success) {
    return persistenceError("persistence", found.error.message);
  }
  if (!found.value) return notFound();
  return NextResponse.json(found.value);
}

export async function handleProjectPut(
  request: NextRequest,
  ownerId: string,
  projectId: string,
): Promise<NextResponse> {
  const gate = guardMutation(request, PROJECT_MUTATION_GUARD);
  if (gate) return gate;

  const parsedId = projectIdSchema.safeParse(projectId);
  if (!parsedId.success) return invalidId();

  const access = await resolveProjectAccess(request, ownerId, parsedId.data);
  if (!access.ok) return access.response;
  if (!CAN_WRITE.includes(access.role)) return insufficientRole();

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const parsedProject = parseSavedProjectBody(parsedBody.body);
  if (!parsedProject.ok) {
    return NextResponse.json(
      { error: "validation", message: parsedProject.message, statusCode: 400 },
      { status: 400 },
    );
  }
  if (parsedProject.project.id !== parsedId.data) {
    return NextResponse.json(
      {
        error: "validation",
        message: "Project id in the body must match the URL",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const precondition = parseIfMatch(request);
  if (!precondition.ok) return precondition.response;

  const store = getPlatformStore();
  const port = store.projectsFor(access.ownerId);
  const updated = port.putProject(parsedProject.project, precondition.expected);
  if (updated.success) {
    store.markProjectsInitialized(access.ownerId);
    return NextResponse.json(updated.value);
  }
  if (updated.error.kind === "Conflict") {
    return NextResponse.json(
      { error: "Conflict", message: updated.error.message, statusCode: 409 },
      { status: 409 },
    );
  }
  if (updated.error.kind === "NotFound") {
    // Create-on-missing is OWNER-only. A write grant authorises editing THE
    // shared project; letting it mint new rows in the owner's tenant would
    // turn "can edit one project" into "can insert projects as the owner"
    // (review flag on #652). A grantee whose target vanished gets 404.
    if (access.role !== "owner") {
      return NextResponse.json(
        { error: "not_found", message: "No such project", statusCode: 404 },
        { status: 404 },
      );
    }
    const created = await port.createProjectRecord(parsedProject.project);
    if (!created.success) {
      return persistenceError(created.error.kind, created.error.message);
    }
    store.markProjectsInitialized(access.ownerId);
    return NextResponse.json(created.value, { status: 201 });
  }
  return persistenceError(updated.error.kind, updated.error.message);
}

export async function handleProjectDelete(
  request: NextRequest,
  ownerId: string,
  projectId: string,
): Promise<NextResponse> {
  const gate = guardMutation(request, PROJECT_MUTATION_GUARD);
  if (gate) return gate;

  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) return invalidId();

  const access = await resolveProjectAccess(request, ownerId, parsed.data);
  if (!access.ok) return access.response;
  // Owner only. A write grant is per-project and must not be able to delete
  // the row it was lent; a grantee leaves by having their grant revoked.
  if (access.role !== "owner") return insufficientRole();

  const store = getPlatformStore();
  const deleted = await store
    .projectsFor(access.ownerId)
    .deleteProjectRecord(parsed.data);
  if (!deleted.success) {
    return persistenceError(deleted.error.kind, deleted.error.message);
  }
  store.markProjectsInitialized(access.ownerId);
  return NextResponse.json({ ok: true });
}
