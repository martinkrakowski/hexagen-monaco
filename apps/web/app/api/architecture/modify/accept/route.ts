import { NextRequest, NextResponse } from "next/server";
import {
  getTransactionManager,
  getManifestMutation,
  getLintValidation,
  MonorepoRootNotFoundError,
} from "@/lib/wire.server";
import { createWebLogger } from "@/lib/wire.shared";
import { guardMutation } from "@/lib/request-guards";
import { validateManifestPath } from "@/lib/manifest-path";
import { AcceptTransactionUseCase } from "@hexagen/transaction-system";

export async function POST(request: NextRequest) {
  // Same-origin + rate-limit gate (D1): commits speculative patches to the
  // on-disk manifest, so reject cross-origin callers and throttle bursts.
  const gate = guardMutation(request);
  if (gate) return gate;

  let transactionId: string | undefined;
  try {
    const body = await request.json();
    const { manifestPath } = body as {
      transactionId?: string;
      manifestPath?: string;
    };
    transactionId = (body as { transactionId?: string }).transactionId;

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: "transactionId is required" },
        { status: 400 },
      );
    }

    let resolvedManifestPath: string;
    try {
      resolvedManifestPath = validateManifestPath(manifestPath);
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

    // Constructed here, from the same composition-root getters the handler
    // always used, rather than behind a new `getAcceptTransactionUseCase()`.
    // A new wire getter would sit OUTSIDE the mocks the Wave-1 route suites
    // install on `@/lib/wire.server`, so the saga they cover would quietly stop
    // running under them — green lines over a mocked-away subject. The use case
    // is stateless; the ports it wraps are the existing singletons.
    const useCase = new AcceptTransactionUseCase(
      getTransactionManager(),
      getManifestMutation(),
      getLintValidation(),
    );
    const outcome = await useCase.execute({
      transactionId,
      manifestPath: resolvedManifestPath,
    });

    const logger = createWebLogger();

    switch (outcome.kind) {
      case "not-found":
        return NextResponse.json(
          { success: false, error: "Transaction not found" },
          { status: 404 },
        );

      case "wrong-state":
        return NextResponse.json(
          {
            success: false,
            error: `Transaction is in '${outcome.status}' state, expected 'speculative'`,
          },
          { status: 409 },
        );

      case "invalid-patch-metadata":
        // The transaction exists and was speculative, but what it stored is not
        // a patch set — a server-side producer defect, not client input, so 5xx.
        // Nothing was written to disk; the use case has already rolled the
        // transaction back so it cannot linger in `speculative`.
        logger.error(
          "[api/architecture/modify/accept] Transaction carries invalid patch metadata",
          { transactionId, reason: outcome.reason },
        );
        return NextResponse.json(
          {
            success: false,
            error: "Transaction patch data is invalid. Patches not applied.",
          },
          { status: 500 },
        );

      case "apply-failed":
        logger.errorWithException(
          outcome.error,
          "[api/architecture/modify/accept] Patch application failed",
        );
        if (outcome.restoreFailure) {
          logger.errorWithException(
            outcome.restoreFailure,
            "[api/architecture/modify/accept] Git restore failed after patch application failure",
          );
        }
        return NextResponse.json(
          {
            success: false,
            error: outcome.restoreFailure
              ? "Patch application failed and git restore failed. Manual intervention required."
              : `Patch application failed: ${outcome.error.message}`,
          },
          { status: 500 },
        );

      case "lint-unavailable":
        // The linter could not run. The patches' validity is unknown, so they
        // were backed out — but this is an infrastructure failure and must not
        // be reported as a lint violation (which would be a 200 with an empty
        // error list, invisible to 5xx monitoring).
        logger.errorWithException(
          outcome.error,
          "[api/architecture/modify/accept] Lint validation could not be run",
        );
        if (outcome.restoreFailure) {
          logger.errorWithException(
            outcome.restoreFailure,
            "[api/architecture/modify/accept] Git restore failed after lint validation error",
          );
        }
        return NextResponse.json(
          {
            success: false,
            error: outcome.restoreFailure
              ? "Lint validation could not be run and git restore failed. Manual intervention required."
              : "Lint validation could not be run. Patches reverted.",
          },
          { status: 500 },
        );

      case "lint-violation":
        if (outcome.restoreFailure) {
          logger.errorWithException(
            outcome.restoreFailure,
            "[api/architecture/modify/accept] Git restore failed after lint violation",
          );
          return NextResponse.json(
            {
              success: false,
              error:
                "Lint validation failed and git restore failed. Manual intervention required.",
              lintErrors: outcome.lintErrors,
            },
            { status: 500 },
          );
        }
        // A genuine lint violation is a normal, expected outcome of accepting a
        // speculative modification — the patches were cleanly reverted, so this
        // keeps its 200 (the UI branches on `success`, not on the status code).
        return NextResponse.json({
          success: false,
          error: "Lint validation failed. Patches reverted.",
          lintPassed: false,
          lintErrors: outcome.lintErrors,
        });

      case "accepted":
        logger.info(
          "[api/architecture/modify/accept] Patches accepted and committed",
          {
            transactionId,
            patchCount: outcome.patchesApplied,
            lintPassed: true,
          },
        );
        return NextResponse.json({
          success: true,
          transactionId,
          status: "committed",
          patchesApplied: outcome.patchesApplied,
          lintPassed: true,
        });
    }
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
