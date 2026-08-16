import { NextResponse, type NextRequest } from "next/server";
import { logger } from "../../../../lib/structured-logger";
import {
  guardManifestBody,
  guardManifestSize,
  guardMutation,
  guardOpenFileContentSize,
  readJsonBody,
} from "../../request-guards";
import type { AISuggestion, SuggestionPort } from "../ports";

/**
 * The `POST /api/governance/suggestions` handler.
 *
 * Shares one {@link SuggestionPort} with `governance/refresh` instead of
 * carrying a second, drifted copy of the LLM wiring (HEX-016). The response
 * shape is unchanged — `{ suggestions }`, plus `error` when no model ran —
 * because `useGovernanceData` reads exactly those two fields.
 */

export interface GovernanceSuggestionsDeps {
  suggestions: SuggestionPort;
}

interface SuggestionsRequestBody {
  manifestYaml: string;
  openFileContent?: string;
}

export async function handleGovernanceSuggestions(
  request: NextRequest,
  deps: GovernanceSuggestionsDeps,
): Promise<NextResponse> {
  // Same-origin + rate-limit gate (D1), before the body is decoded and before
  // any model is called. #443 put this on the four modify routes and on
  // `governance/refresh` for exactly the reason that applies here — the route
  // "call[s] the LLM" — but this sibling was missed: it reaches the same
  // `SuggestionPort`, per request, on the caller's word alone. It shares the
  // `mutation` limiter bucket with `refresh` so the two cannot be alternated to
  // double the budget. `useGovernanceData` calls this same-origin, so the only
  // traffic the gate turns away is traffic that was never the UI's.
  const gate = guardMutation(request);
  if (gate) return gate;

  try {
    // Decode the body FIRST, mapping a malformed/empty JSON body to a 400
    // instead of letting request.json() reject into the outer catch (a 500).
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    // Validate the decoded body shape before trusting the `as` cast below.
    const invalidBody = guardManifestBody(body);
    if (invalidBody) return invalidBody;
    const { manifestYaml, openFileContent } = body as SuggestionsRequestBody;

    const tooLarge = guardManifestSize(manifestYaml);
    if (tooLarge) return tooLarge;

    // The optional open file is appended verbatim to the LLM prompt — bound its
    // size and reject a non-string before it reaches the prompt.
    const openFileTooLarge = guardOpenFileContentSize(openFileContent);
    if (openFileTooLarge) return openFileTooLarge;

    const outcome = await deps.suggestions.suggest({
      manifestYaml,
      openFileContent,
    });

    if (outcome.kind === "unavailable") {
      const suggestions: AISuggestion[] = [];
      return NextResponse.json({ suggestions, error: outcome.reason });
    }

    return NextResponse.json({ suggestions: outcome.suggestions });
  } catch (err) {
    logger.error("Governance suggestions error:", { error: err });
    return NextResponse.json(
      { error: "Internal Server Error", suggestions: [] },
      { status: 500 },
    );
  }
}
