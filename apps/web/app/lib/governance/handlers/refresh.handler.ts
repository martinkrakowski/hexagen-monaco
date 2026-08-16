import { NextResponse, type NextRequest } from "next/server";
import { logger } from "../../../../lib/structured-logger";
import {
  guardManifestBody,
  guardManifestSize,
  guardMutation,
  guardOpenFileContentSize,
  readJsonBody,
} from "../../request-guards";
import { analyzeManifest, type PortAdapterStatus } from "../manifest-analysis";
import type {
  AISuggestion,
  ManifestLintPort,
  SuggestionPort,
  Violation,
} from "../ports";

/**
 * The `POST /api/governance/refresh` handler, extracted out of the route module
 * so its two I/O collaborators can be passed in (HEX-016).
 *
 * Next.js route files may only export the HTTP verbs it recognises, so the
 * handler cannot take its dependencies as a second parameter and still live in
 * `route.ts`. Keeping it here means the route is a wiring shim over the
 * composition root, and the tests below exercise the real mapping with explicit
 * fakes — no module mocking, and nothing about the transport is stubbed out.
 */

export interface GovernanceRefreshDeps {
  lint: ManifestLintPort;
  suggestions: SuggestionPort;
}

interface RefreshRequestBody {
  manifestYaml: string;
  openFileContent?: string;
}

export interface GovernanceRefreshResponse {
  violations: Violation[];
  suggestions: AISuggestion[];
  portAdapterStatus: PortAdapterStatus[];
  /** The manifest could not be parsed/shaped (AUD-005, item 1.6). */
  statusError?: string;
  /** The architecture linter could not be run — verdict unknown, not clean. */
  lintError?: string;
  /** No model looked at the manifest — not "the model had nothing to say". */
  suggestionsError?: string;
}

export async function handleGovernanceRefresh(
  request: NextRequest,
  deps: GovernanceRefreshDeps,
): Promise<NextResponse> {
  // Same-origin + rate-limit gate (D1): this endpoint spawns `yarn lint:arch`
  // (a subprocess) and calls the LLM, so reject cross-origin callers and
  // throttle bursts before doing any of that work.
  const gate = guardMutation(request);
  if (gate) return gate;

  try {
    // Decode the body FIRST, mapping a malformed/empty JSON body to a 400
    // instead of letting request.json() reject into the outer catch (a 500).
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    // Validate the decoded body shape before trusting the `as` cast below: a
    // `null` body or a non-string `manifestYaml` would otherwise slip past the
    // size guard and reach the shell-lint / LLM / parse work.
    const invalidBody = guardManifestBody(body);
    if (invalidBody) return invalidBody;
    const { manifestYaml, openFileContent } = body as RefreshRequestBody;

    // Bound the raw manifest before the shell-lint / LLM / parse work below.
    const tooLarge = guardManifestSize(manifestYaml);
    if (tooLarge) return tooLarge;

    // The optional open file is appended verbatim to the suggestion LLM prompt —
    // bound its size and reject a non-string before it reaches the prompt.
    const openFileTooLarge = guardOpenFileContentSize(openFileContent);
    if (openFileTooLarge) return openFileTooLarge;

    // Lint (subprocess) and suggestions (LLM) are independent I/O; the manifest
    // analysis is a pure function. Run the two async ports concurrently.
    const [lintOutcome, suggestionOutcome] = await Promise.all([
      deps.lint.lintManifest(manifestYaml),
      deps.suggestions.suggest({ manifestYaml, openFileContent }),
    ]);

    // Derive port/adapter status from the manifest via the shared analyzer, so
    // `refresh` and `governance/status` agree on the same manifest (AUD-005). A
    // manifest that will not parse is not "healthy with zero contexts" — carry
    // the analyzer's error out instead of masking it as an empty status list.
    const analysis = analyzeManifest(manifestYaml);

    const response: GovernanceRefreshResponse = {
      // A linter that could not run contributes NO violations. The previous
      // implementation split its stderr into lines and returned each as a
      // HIGH-severity architectural error, so `yarn: not found` and the
      // linter's own `FATAL ERROR:` banner were rendered as findings about the
      // user's architecture.
      violations:
        lintOutcome.kind === "violations"
          ? lintOutcome.messages.map((message, index) => ({
              id: String(index + 1),
              type: "error" as const,
              message,
              severity: "HIGH" as const,
            }))
          : [],
      suggestions:
        suggestionOutcome.kind === "suggestions"
          ? suggestionOutcome.suggestions
          : [],
      portAdapterStatus: analysis.ok ? analysis.status : [],
    };

    if (!analysis.ok) response.statusError = analysis.error;
    if (lintOutcome.kind === "unavailable") {
      response.lintError = `Architecture linter unavailable: ${lintOutcome.reason}`;
      logger.warn("[governance/refresh] lint unavailable", {
        reason: lintOutcome.reason,
      });
    }
    if (suggestionOutcome.kind === "unavailable") {
      response.suggestionsError = suggestionOutcome.reason;
    }

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Governance refresh failed";
    logger.error("[governance/refresh] Failed:", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
