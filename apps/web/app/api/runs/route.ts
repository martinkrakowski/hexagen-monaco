import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardMutation, readJsonBody } from "../../lib/request-guards";
import { getPlatformStore } from "../../../lib/platform";

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
  const store = getPlatformStore();
  return NextResponse.json({
    events: store.runs.list({ projectId, limit: 100 }),
    trend: store.runs.trend(14),
  });
}

export async function POST(request: NextRequest) {
  const gate = guardMutation(request);
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
  const recorded = getPlatformStore().runs.record(parsed.data);
  return NextResponse.json(recorded, { status: 201 });
}
