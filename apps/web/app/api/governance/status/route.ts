import { NextResponse } from "next/server";
import { logger } from "../../../../lib/structured-logger";
import { analyzeManifest } from "@/lib/governance/manifest-analysis";
import { guardManifestBody, guardManifestSize } from "@/lib/request-guards";

interface StatusRequestBody {
  manifestYaml: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;

    // Validate the decoded body shape before trusting the `as` cast below: a
    // `null` body or a non-string `manifestYaml` would otherwise slip past the
    // size guard and reach the analyzer.
    const invalidBody = guardManifestBody(body);
    if (invalidBody) return invalidBody;
    const { manifestYaml } = body as StatusRequestBody;

    const tooLarge = guardManifestSize(manifestYaml);
    if (tooLarge) return tooLarge;

    const analysis = analyzeManifest(manifestYaml);
    if (!analysis.ok) {
      // A manifest that will not parse is not "healthy with zero contexts" —
      // surface the parse error explicitly instead of an empty status (AUD-005).
      return NextResponse.json({ status: [], error: analysis.error });
    }

    return NextResponse.json({ status: analysis.status });
  } catch (err) {
    logger.error("Governance status error:", { error: err });
    return NextResponse.json(
      { error: "Internal Server Error", status: [] },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with manifestYaml in request body", status: [] },
    { status: 405, headers: { Allow: "POST" } },
  );
}
