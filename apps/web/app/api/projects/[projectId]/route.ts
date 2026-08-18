import { NextRequest, NextResponse } from "next/server";
import { projectIdSchema } from "../../../lib/schemas/project-id-schema";
import { guardMutation, readJsonBody } from "../../../lib/request-guards";
import { getPlatformStore } from "../../../../lib/platform";
import { parseSavedProjectBody } from "../../../../lib/platform/saved-project-body";
import {
  PROJECT_MUTATION_GUARD,
  requirePersistenceOwner,
} from "../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  const { projectId } = await params;
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) return invalidId();

  const loaded = await getPlatformStore()
    .projectsFor(owner.ownerId)
    .loadProjects();
  if (!loaded.success) {
    return NextResponse.json(
      {
        error: "persistence",
        message: loaded.error.message,
        statusCode: 500,
      },
      { status: 500 },
    );
  }
  const project = loaded.value.find((entry) => entry.id === parsed.data);
  if (!project) {
    return NextResponse.json(
      {
        error: "not_found",
        message: "Project not found",
        statusCode: 404,
      },
      { status: 404 },
    );
  }
  return NextResponse.json(project);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;
  const gate = guardMutation(request, PROJECT_MUTATION_GUARD);
  if (gate) return gate;

  const { projectId } = await params;
  const parsedId = projectIdSchema.safeParse(projectId);
  if (!parsedId.success) return invalidId();

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const parsedProject = parseSavedProjectBody(parsedBody.body);
  if (!parsedProject.ok) {
    return NextResponse.json(
      {
        error: "validation",
        message: parsedProject.message,
        statusCode: 400,
      },
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
  const port = store.projectsFor(owner.ownerId);
  const updated = port.putProject(parsedProject.project, precondition.expected);
  if (updated.success) {
    store.markProjectsInitialized(owner.ownerId);
    return NextResponse.json(updated.value);
  }
  if (updated.error.kind === "Conflict") {
    return NextResponse.json(
      {
        error: "Conflict",
        message: updated.error.message,
        statusCode: 409,
      },
      { status: 409 },
    );
  }
  if (updated.error.kind === "NotFound") {
    const created = await port.createProjectRecord(parsedProject.project);
    if (!created.success) {
      return NextResponse.json(
        {
          error: created.error.kind,
          message: created.error.message,
          statusCode: 500,
        },
        { status: 500 },
      );
    }
    store.markProjectsInitialized(owner.ownerId);
    return NextResponse.json(created.value, { status: 201 });
  }
  return NextResponse.json(
    {
      error: updated.error.kind,
      message: updated.error.message,
      statusCode: 500,
    },
    { status: 500 },
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;
  const gate = guardMutation(request, PROJECT_MUTATION_GUARD);
  if (gate) return gate;

  const { projectId } = await params;
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) return invalidId();

  const store = getPlatformStore();
  const deleted = await store
    .projectsFor(owner.ownerId)
    .deleteProjectRecord(parsed.data);
  if (!deleted.success) {
    return NextResponse.json(
      {
        error: deleted.error.kind,
        message: deleted.error.message,
        statusCode: 500,
      },
      { status: 500 },
    );
  }
  store.markProjectsInitialized(owner.ownerId);
  return NextResponse.json({ ok: true });
}
