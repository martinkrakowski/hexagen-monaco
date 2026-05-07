import { NextRequest, NextResponse } from "next/server";
import { projectIdSchema } from "../../../lib/schemas/project-id-schema";
import { getProjectById, updateProjectName } from "../../../lib/data/projects";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation",
        message: "Invalid project ID format",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const project = await getProjectById(parsed.data);
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

  return NextResponse.json({
    id: project.id,
    name: project.name,
    formState: project.formState,
    manifestYaml: project.manifestYaml,
    createdAt: project.createdAt,
    lastModifiedAt: project.updatedAt,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation",
        message: "Invalid project ID format",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "invalid_body",
        message: "Invalid JSON body",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("name" in body) ||
    typeof (body as Record<string, unknown>).name !== "string"
  ) {
    return NextResponse.json(
      {
        error: "validation",
        message: "Request body must include a 'name' string field",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  const result = await updateProjectName(
    parsed.data,
    (body as Record<string, unknown>).name as string,
  );
  if (!result) {
    return NextResponse.json(
      {
        error: "not_found",
        message: "Project not found",
        statusCode: 404,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    id: result.id,
    name: result.name,
    formState: result.formState,
    manifestYaml: result.manifestYaml,
    createdAt: result.createdAt,
    lastModifiedAt: result.updatedAt,
  });
}
