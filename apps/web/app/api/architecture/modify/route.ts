// apps/web/app/api/architecture/modify/route.ts
// Endpoint to modify architecture via natural language intent

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  getModifyArchitectureUseCase,
  findMonorepoRoot,
  MonorepoRootNotFoundError,
} from "@/lib/wire.server";
import { createWebLogger } from "@/lib/wire.shared";
import { guardMutation } from "@/lib/request-guards";
import type { IntentLineage } from "@hexagen/core-domain";

/**
 * Validates that a manifest path is within the allowed .architecture directory.
 * Prevents directory traversal attacks by normalizing and checking path boundaries.
 * @throws {Error} If path traversal is detected
 */
function validateManifestPath(rawPath: string): string {
  // Anchor path resolution + the traversal gate at the monorepo root — the same anchor the mutation/lint adapters use (findMonorepoRoot), NOT process.cwd() (which is apps/web in prod).
  const cwd = findMonorepoRoot();
  const allowedBase = path.join(cwd, ".architecture");
  const resolvedPath = path.resolve(cwd, rawPath);

  if (
    !resolvedPath.startsWith(allowedBase + path.sep) &&
    resolvedPath !== allowedBase
  ) {
    throw new Error(
      `Invalid path: traversal detected. Path must be within .architecture directory.`,
    );
  }

  return resolvedPath;
}

interface ModifyRequestBody {
  intent: string;
  manifestPath?: string;
  lineage?: IntentLineage;
}

export async function POST(request: NextRequest) {
  // Same-origin + rate-limit gate (D1): this endpoint mutates the on-disk
  // manifest, so it must reject cross-origin callers and throttle bursts.
  const gate = guardMutation(request);
  if (gate) return gate;

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

  let manifestPath: string;
  try {
    manifestPath = validateManifestPath(
      body.manifestPath ?? ".architecture/manifest.yaml",
    );
  } catch (err) {
    // A missing on-disk manifest anchor is a server config failure, not bad
    // client input — surface it as 5xx (and log) so monitoring sees it, rather
    // than masking it as a 400. Only path-traversal input yields 400 below.
    if (err instanceof MonorepoRootNotFoundError) {
      const logger = createWebLogger();
      // Full detail (incl. the process.cwd() path) goes to the SERVER LOG only.
      logger.errorWithException(
        err,
        "[api/architecture/modify] Manifest root not found",
      );
      // The client body is the stable, path-free message — NOT err.message,
      // whose text embeds the server filesystem path; echoing it would leak the
      // server layout to callers (CWE-209). The wildcard-CORS contract this
      // route once carried is retired here as part of the same-origin migration
      // (AUD-003): the guardMutation gate above now rejects cross-origin
      // callers, so no Access-Control-* headers remain on any response.
      return NextResponse.json(
        { error: MonorepoRootNotFoundError.clientMessage },
        { status: 500 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Invalid manifest path";
    return NextResponse.json({ error: message }, { status: 400 });
  }
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
    const logger = createWebLogger();
    logger.errorWithException(err, "[api/architecture/modify] Failed");
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
