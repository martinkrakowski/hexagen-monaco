import { NextResponse } from "next/server";
import { logger } from "../../../../lib/structured-logger";
import { analyzeManifest } from "../../../lib/governance/manifest-analysis";
import { guardManifestSize } from "../../../lib/request-guards";

interface ViolationsRequestBody {
  manifestYaml: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ViolationsRequestBody;

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
      // A manifest that will not parse must NOT report as compliant (AUD-005).
      // Surface the parse failure as a HIGH error violation so the caller sees a
      // non-compliant result rather than a false green.
      return NextResponse.json({
        violations: [
          {
            id: "manifest-parse-error",
            type: "error",
            message: analysis.error,
            severity: "HIGH",
          },
        ],
        isCompliant: false,
        error: analysis.error,
      });
    }

    return NextResponse.json({
      violations: analysis.violations,
      isCompliant: analysis.isCompliant,
    });
  } catch (err) {
    logger.error("Governance violations error:", { error: err });
    return NextResponse.json(
      {
        error: "Internal Server Error",
        violations: [],
        isCompliant: false,
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  // A 405 carries no compliance verdict — never emit `isCompliant: true` from a
  // non-success response (AUD-005: only a parsed, error-free manifest is compliant).
  return NextResponse.json(
    {
      error: "Use POST with manifestYaml in request body",
      violations: [],
      isCompliant: false,
    },
    {
      status: 405,
      headers: { Allow: "POST" },
    },
  );
}
