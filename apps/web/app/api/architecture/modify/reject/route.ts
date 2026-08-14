import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  getTransactionManager,
  getManifestMutation,
  findMonorepoRoot,
} from "@/lib/wire.server";
import { createWebLogger } from "@/lib/wire.shared";

// Anchor path resolution + the traversal gate at the monorepo root — the same anchor the mutation/lint adapters use (findMonorepoRoot), NOT process.cwd() (which is apps/web in prod).
function validateManifestPath(rawPath: string): string {
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

export async function POST(request: NextRequest) {
  let transactionId: string | undefined;
  try {
    const body = await request.json();
    transactionId = (body as { transactionId?: string }).transactionId;
    const { manifestPath, reason } = body as {
      transactionId?: string;
      manifestPath?: string;
      reason?: string;
    };

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: "transactionId is required" },
        { status: 400 },
      );
    }

    const transactionManager = getTransactionManager();
    const tx = transactionManager.get(transactionId);
    if (!tx) {
      return NextResponse.json(
        { success: false, error: "Transaction not found" },
        { status: 404 },
      );
    }

    if (tx.status !== "speculative") {
      return NextResponse.json(
        {
          success: false,
          error: `Transaction is in '${tx.status}' state, expected 'speculative'`,
        },
        { status: 409 },
      );
    }

    let resolvedManifestPath: string | undefined;
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
        { status: 400 },
      );
    }

    const manifestMutation = getManifestMutation();
    const restoreResult =
      await manifestMutation.restoreFromGit(resolvedManifestPath);
    if (!restoreResult.success) {
      const logger = createWebLogger();
      logger.errorWithException(
        restoreResult.error,
        "[api/architecture/modify/reject] Defensive git restore failed",
      );
      // Roll back the in-memory transaction regardless of the on-disk git
      // restore outcome so it is never stuck in 'speculative'; the failed
      // file restore is surfaced separately below.
      transactionManager.rollback(transactionId, reason ?? "User rejected");
      return NextResponse.json(
        {
          success: false,
          error:
            "Failed to restore manifest from git. Manual intervention may be required.",
          details: restoreResult.error,
        },
        { status: 500 },
      );
    }

    transactionManager.rollback(transactionId, reason ?? "User rejected");

    const logger = createWebLogger();
    logger.info("[api/architecture/modify/reject] Transaction rolled back", {
      transactionId,
      reason: reason ?? "User rejected the changes",
    });

    return NextResponse.json({
      success: true,
      transactionId,
      status: "rolled_back",
      reason: reason ?? "User rejected the changes",
    });
  } catch (error) {
    const logger = createWebLogger();
    logger.errorWithException(
      error,
      `[api/architecture/modify/reject] Unexpected error${transactionId ? ` for transaction ${transactionId}` : ""}`,
    );
    const message =
      error instanceof Error
        ? error.message
        : "Reject failed: unexpected error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
