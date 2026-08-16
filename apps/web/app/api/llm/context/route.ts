/**
 * GET /api/llm/context
 * Compact governance context for the in-browser LLM assistant.
 *
 * HEX-034: transport only. The manifest read is the composition root's
 * (`getMergedManifestProvider`), and the port-ownership / invariant projection
 * is a pure function in `app/lib/governance/governance-context.ts`. This handler
 * used to do its own workspace-root walk, call `mergeSplitManifest` directly,
 * and encode the ownership rules inline.
 */
import { NextResponse } from "next/server";
import { getMergedManifestProvider } from "../../../lib/wire.server";
import {
  createEmptyGovernanceContext,
  projectGovernanceContext,
  type GovernanceContextPayload,
} from "../../../lib/governance/governance-context";

export async function GET(): Promise<
  NextResponse<GovernanceContextPayload | { error: string }>
> {
  try {
    const manifest = await getMergedManifestProvider().getMergedManifest();

    // No locatable / parseable manifest is a degraded-but-serviceable state:
    // the assistant loses its grounding but the panel still renders. Preserved
    // from the inline version, which caught both failures the same way.
    if (!manifest) {
      return NextResponse.json(createEmptyGovernanceContext(), { status: 200 });
    }

    return NextResponse.json(projectGovernanceContext(manifest), {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
