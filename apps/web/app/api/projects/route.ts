import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardMutation, readJsonBody } from "../../lib/request-guards";
import { getPlatformStore } from "../../../lib/platform";
import { parseSavedProjectBody } from "../../../lib/platform/saved-project-body";
import {
  PROJECT_MUTATION_GUARD,
  requirePersistenceOwner,
} from "../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  const store = getPlatformStore();
  const loaded = await store.projectsFor(owner.ownerId).loadProjects();
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
  return NextResponse.json({
    projects: loaded.value,
    initialized: store.isProjectsInitialized(owner.ownerId),
    ownerId: owner.ownerId,
  });
}

export async function POST(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;
  const gate = guardMutation(request, PROJECT_MUTATION_GUARD);
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

  const created = await getPlatformStore()
    .projectsFor(owner.ownerId)
    .createProjectRecord(parsedProject.project);
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
  getPlatformStore().markProjectsInitialized(owner.ownerId);
  return NextResponse.json(created.value, { status: 201 });
}

const replaceBodySchema = z.object({
  projects: z.array(z.unknown()),
});

export async function PUT(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;
  const gate = guardMutation(request, PROJECT_MUTATION_GUARD);
  if (gate) return gate;

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = replaceBodySchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation",
        message: "Invalid saved project list",
        statusCode: 400,
      },
      { status: 400 },
    );
  }
  const projects = [];
  for (const entry of parsed.data.projects) {
    const project = parseSavedProjectBody(entry);
    if (!project.ok) {
      return NextResponse.json(
        {
          error: "validation",
          message: project.message,
          statusCode: 400,
        },
        { status: 400 },
      );
    }
    projects.push(project.project);
  }

  const written = await getPlatformStore()
    .projectsFor(owner.ownerId)
    .saveProjects(projects);
  if (!written.success) {
    return NextResponse.json(
      {
        error: written.error.kind,
        message: written.error.message,
        statusCode: 500,
      },
      { status: 500 },
    );
  }
  getPlatformStore().markProjectsInitialized(owner.ownerId);
  return NextResponse.json({ projects, initialized: true });
}
