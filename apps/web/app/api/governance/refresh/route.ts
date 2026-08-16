import type { NextRequest } from "next/server";
import { handleGovernanceRefresh } from "@/lib/governance/handlers/refresh.handler";
import { getGovernanceSuggestions, getManifestLint } from "@/lib/wire.server";

/**
 * Transport only (HEX-016). The subprocess, the temp file and the LLM wiring
 * this module used to own live behind `ManifestLintPort` / `SuggestionPort`;
 * the adapters are built in `wire.server.ts`, and the request/response mapping
 * is in the handler.
 *
 * `apps/web/eslint.config.js` forbids `child_process`, `fs`, `os` and the
 * `@hexagen/agentic-interaction` adapter exports under `app/api/governance/**`,
 * so re-inlining any of them fails `turbo lint` rather than sliding back in.
 *
 * The adapters are resolved per request, not at module load, so the composition
 * root is not evaluated while Next collects route metadata.
 */
export async function POST(request: NextRequest) {
  return handleGovernanceRefresh(request, {
    lint: getManifestLint(),
    suggestions: getGovernanceSuggestions(),
  });
}
