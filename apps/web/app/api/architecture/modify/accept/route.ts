import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  getTransactionManager,
  getManifestMutation,
  getLintValidation,
} from "@/lib/wire.server";
import { createWebLogger } from "@/lib/wire.shared";

function validateManifestPath(rawPath: string): string {
  const cwd = process.cwd();
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

export async function POST(request: NextRequest) {
  let transactionId: string | undefined;
  try {
    const body = await request.json();
    transactionId = (body as { transactionId?: string }).transactionId;
    const { manifestPath } = body as {
      transactionId?: string;
      manifestPath?: string;
    };

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: "transactionId is required" },
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        },
      );
    }

    const transactionManager = getTransactionManager();
    const tx = transactionManager.get(transactionId);
    if (!tx) {
      return NextResponse.json(
        { success: false, error: "Transaction not found" },
        {
          status: 404,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        },
      );
    }

    if (tx.status !== "speculative") {
      return NextResponse.json(
        {
          success: false,
          error: `Transaction is in '${tx.status}' state, expected 'speculative'`,
        },
        {
          status: 409,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        },
      );
    }

    let resolvedManifestPath: string;
    try {
      resolvedManifestPath = validateManifestPath(
        manifestPath ?? ".architecture/manifest.yaml",
      );
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Invalid manifest path",
        },
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        },
      );
    }

    const patches = (tx.metadata.patches ??
      []) as import("@hexagen/core-domain").Patch[];

    const manifestMutation = getManifestMutation();
    const applyResult = await manifestMutation.applyPatches(
      patches,
      resolvedManifestPath,
    );
    if (!applyResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Patch application failed: ${applyResult.error.message}`,
        },
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        },
      );
    }

    const lintValidation = getLintValidation();
    const lintResult =
      await lintValidation.validateManifest(resolvedManifestPath);
    let lintPassed = false;
    let lintErrors: string[] = [];

    if (lintResult.success) {
      lintPassed = lintResult.value.valid;
      lintErrors = lintResult.value.errors;
    }

    if (!lintPassed) {
      const restoreResult =
        await manifestMutation.restoreFromGit(resolvedManifestPath);
      if (!restoreResult.success) {
        const logger = createWebLogger();
        logger.errorWithException(
          restoreResult.error,
          "[api/architecture/modify/accept] Git restore failed after lint violation",
        );
        return NextResponse.json(
          {
            success: false,
            error:
              "Lint validation failed and git restore failed. Manual intervention required.",
            lintErrors,
          },
          {
            status: 500,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          },
        );
      }

      transactionManager.rollback(transactionId);

      return NextResponse.json(
        {
          success: false,
          error: "Lint validation failed. Patches reverted.",
          lintPassed: false,
          lintErrors,
        },
        {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        },
      );
    }

    transactionManager.commit(transactionId);

    const logger = createWebLogger();
    logger.info(
      "[api/architecture/modify/accept] Patches accepted and committed",
      {
        transactionId,
        patchCount: patches.length,
        lintPassed,
      },
    );

    return NextResponse.json(
      {
        success: true,
        transactionId,
        status: "committed",
        patchesApplied: patches.length,
        lintPassed,
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      },
    );
  } catch (error) {
    const logger = createWebLogger();
    logger.errorWithException(
      error,
      `[api/architecture/modify/accept] Unexpected error${transactionId ? ` for transaction ${transactionId}` : ""}`,
    );
    const message =
      error instanceof Error
        ? error.message
        : "Accept failed: unexpected error";
    return NextResponse.json(
      { success: false, error: message },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      },
    );
  }
}

/**
 * OPTIONS /api/architecture/modify/accept
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
