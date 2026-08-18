import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardMutation, readJsonBody } from "../../lib/request-guards";
import { getPlatformStore } from "../../../lib/platform";
import {
  PROJECT_MUTATION_GUARD,
  requirePersistenceOwner,
} from "../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const telemetrySchema = z.object({
  stage: z.number(),
  label: z.string(),
  durationMs: z.number(),
  usedLLM: z.boolean(),
  retryCount: z.number(),
  inputTokensEstimate: z.number(),
  outputTokensActual: z.number(),
  servedFromCache: z.boolean(),
  summary: z.string(),
  modelName: z.string().optional(),
  refinerModelName: z.string().optional(),
});

const persistBodySchema = z.object({
  runId: z.string().min(1).optional(),
  projectId: z.string().uuid().optional(),
  telemetry: telemetrySchema,
});

export async function GET(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined;
  if (projectId) {
    const parsed = z.string().uuid().safeParse(projectId);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation", message: "Invalid project ID format" },
        { status: 400 },
      );
    }
  }
  const runs = getPlatformStore().runsFor(owner.ownerId);
  return NextResponse.json({
    events: runs.list({ projectId, limit: 100 }),
    trend: runs.trend(14),
  });
}

export async function POST(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;
  const gate = guardMutation(request, PROJECT_MUTATION_GUARD);
  if (gate) return gate;

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = persistBodySchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", message: "Invalid run telemetry payload" },
      { status: 400 },
    );
  }
  const recorded = getPlatformStore()
    .runsFor(owner.ownerId)
    .record(parsed.data);
  return NextResponse.json(recorded, { status: 201 });
}
