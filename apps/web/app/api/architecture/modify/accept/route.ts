import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  getTransactionManager,
  getManifestMutation,
  getLintValidation,
  findMonorepoRoot,
  MonorepoRootNotFoundError,
} from "@/lib/wire.server";
import { createWebLogger } from "@/lib/wire.shared";
import { guardMutation } from "@/lib/request-guards";

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
  // Same-origin + rate-limit gate (D1): commits speculative patches to the
  // on-disk manifest, so reject cross-origin callers and throttle bursts.
  const gate = guardMutation(request);
  if (gate) return gate;

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

    let resolvedManifestPath: string;
    try {
      resolvedManifestPath = validateManifestPath(
        manifestPath ?? ".architecture/manifest.yaml",
      );
    } catch (err) {
      // A missing on-disk manifest anchor is a server config failure, not bad
      // client input — rethrow to the outer 5xx handler (logged there) so it is
      // never masked as a 400. Only path-traversal input yields 400 below.
      if (err instanceof MonorepoRootNotFoundError) throw err;
      return NextResponse.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Invalid manifest path",
        },
        { status: 400 },
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
        { status: 500 },
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
        // Roll back the in-memory transaction regardless of the on-disk git
        // restore outcome: the speculative snapshot + backpressure must be
        // released so the transaction is never stuck in 'speculative'. The
        // failed file restore is surfaced separately below.
        transactionManager.rollback(transactionId);
        return NextResponse.json(
          {
            success: false,
            error:
              "Lint validation failed and git restore failed. Manual intervention required.",
            lintErrors,
          },
          { status: 500 },
        );
      }

      transactionManager.rollback(transactionId);

      return NextResponse.json({
        success: false,
        error: "Lint validation failed. Patches reverted.",
        lintPassed: false,
        lintErrors,
      });
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

    return NextResponse.json({
      success: true,
      transactionId,
      status: "committed",
      patchesApplied: patches.length,
      lintPassed,
    });
  } catch (error) {
    const logger = createWebLogger();
    logger.errorWithException(
      error,
      `[api/architecture/modify/accept] Unexpected error${transactionId ? ` for transaction ${transactionId}` : ""}`,
    );
    // The anchor error rethrown from path validation lands here (this outer 5xx
    // catch-all). Map it to the stable, path-free client message — its raw
    // .message embeds the server filesystem path, which must never reach a
    // client-facing error body regardless of CORS (CWE-209). Full detail is
    // already logged above; other errors are unchanged.
    const message =
      error instanceof MonorepoRootNotFoundError
        ? MonorepoRootNotFoundError.clientMessage
        : error instanceof Error
          ? error.message
          : "Accept failed: unexpected error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
