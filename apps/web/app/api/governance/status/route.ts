import { NextResponse } from "next/server";
import { logger } from "../../../../lib/structured-logger";
import { analyzeManifest } from "@/lib/governance/manifest-analysis";
import { guardManifestSize } from "@/lib/request-guards";

interface StatusRequestBody {
  manifestYaml: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StatusRequestBody;

    if (!body.manifestYaml) {
      return NextResponse.json(
        { error: "manifestYaml is required" },
        { status: 400 },
      );
    }

    const tooLarge = guardManifestSize(body.manifestYaml);
    if (tooLarge) return tooLarge;

    const analysis = analyzeManifest(body.manifestYaml);
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
