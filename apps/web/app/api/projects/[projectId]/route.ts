import { NextRequest, NextResponse } from "next/server";
import { projectIdSchema } from "../../../lib/schemas/project-id-schema";
import { guardMutation, readJsonBody } from "../../../lib/request-guards";
import { getPlatformStore } from "../../../../lib/platform";
import { parseSavedProjectBody } from "../../../../lib/platform/saved-project-body";

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) return invalidId();

  const loaded = await getPlatformStore().projects.loadProjects();
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
  const gate = guardMutation(request);
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

  const port = getPlatformStore().projects;
  const updated = await port.updateProjectRecord(parsedId.data, () => {
    return parsedProject.project;
  });
  if (updated.success) {
    return NextResponse.json(updated.value);
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
  const gate = guardMutation(request);
  if (gate) return gate;

  const { projectId } = await params;
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) return invalidId();

  const deleted = await getPlatformStore().projects.deleteProjectRecord(
    parsed.data,
  );
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
  return NextResponse.json({ ok: true });
}
