import { NextRequest, NextResponse } from "next/server";
import { projectIdSchema } from "../../../lib/schemas/project-id-schema";

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

  return NextResponse.json(
    {
      error: "not_implemented",
      message:
        "Project data is stored client-side in IndexedDB. Use the client-side useSavedProjects hook to access projects.",
      statusCode: 501,
    },
    { status: 501 },
  );
}

export async function POST(
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

  return NextResponse.json(
    {
      error: "not_implemented",
      message:
        "Project data is stored client-side in IndexedDB. Use the client-side useSavedProjects hook to update projects.",
      statusCode: 501,
    },
    { status: 501 },
  );
}
