// apps/web/app/api/architecture/modify/route.ts
// Endpoint to modify architecture via natural language intent

import { NextRequest, NextResponse } from "next/server";
import { getModifyArchitectureUseCase } from "@/lib/wire.architecture-modification";
import { getLogger } from "@/lib/wire";
import type { IntentLineage } from "@hexagen/core-domain";

interface ModifyRequestBody {
  intent: string;
  manifestPath?: string;
  lineage?: IntentLineage;
}

export async function POST(request: NextRequest) {
  let body: ModifyRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  if (!body.intent || typeof body.intent !== "string") {
    return NextResponse.json(
      { error: "'intent' must be a non-empty string." },
      { status: 400 },
    );
  }

  const manifestPath = body.manifestPath ?? ".architecture/manifest.yaml";
  const lineage: IntentLineage = body.lineage ?? {
    intentId: `intent-${Date.now()}_v1`,
    origin: { type: "user", actorId: "api" },
    timestamp: Date.now(),
    targetContract: { mvkVersion: "1", rrpVersion: "1", remVersion: "1" },
    validation: { valid: true },
  };

  try {
    const useCase = getModifyArchitectureUseCase();
    const result = await useCase.execute(body.intent, manifestPath, lineage);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      pipelineRunId: result.value.pipelineRunId,
      patchesApplied: result.value.patchesApplied,
      lintPassed: result.value.lintPassed,
      transactionId: result.value.transactionId,
      patches: result.value.patches ?? [],
      steps: result.value.steps.map((s) => ({
        name: s.name,
        status: s.status,
        durationMs: s.endTime ? s.endTime - s.startTime : null,
        error: s.error ?? null,
      })),
    });
  } catch (err) {
    const logger = getLogger();
    logger.errorWithException(err, "[api/architecture/modify] Failed");
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
