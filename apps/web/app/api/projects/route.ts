import { NextRequest, NextResponse } from "next/server";
import { guardMutation, readJsonBody } from "../../lib/request-guards";
import { getPlatformStore } from "../../../lib/platform";
import { parseSavedProjectBody } from "../../../lib/platform/saved-project-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
  return NextResponse.json({ projects: loaded.value });
}

export async function POST(request: NextRequest) {
  const gate = guardMutation(request);
  if (gate) return gate;

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

  const created = await getPlatformStore().projects.createProjectRecord(
    parsedProject.project,
  );
  if (!created.success) {
    const status = created.error.kind === "Conflict" ? 409 : 500;
    return NextResponse.json(
      {
        error: created.error.kind,
        message: created.error.message,
        statusCode: status,
      },
      { status },
    );
  }
  return NextResponse.json(created.value, { status: 201 });
}
