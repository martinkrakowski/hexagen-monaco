import { NextResponse, type NextRequest } from "next/server";
import { handleGovernanceSuggestions } from "@/lib/governance/handlers/suggestions.handler";
import { getGovernanceSuggestions } from "@/lib/wire.server";

/**
 * Transport only (HEX-016). The `SuggestionPort` adapter is built in
 * `wire.server.ts`.
 */
export async function POST(request: NextRequest) {
  return handleGovernanceSuggestions(request, {
    suggestions: getGovernanceSuggestions(),
  });
}

export async function GET() {
  return NextResponse.json(
    {
      error: "Use POST with manifestYaml and optional openFileContent",
      suggestions: [],
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
