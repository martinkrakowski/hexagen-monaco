import { NextResponse } from "next/server";
import { logger } from "../../../../lib/structured-logger";
import { analyzeManifest } from "@/lib/governance/manifest-analysis";
import {
  readJsonBody,
  guardManifestBody,
  guardManifestSize,
} from "@/lib/request-guards";

interface ViolationsRequestBody {
  manifestYaml: string;
}

export async function POST(request: Request) {
  try {
    // Decode the body FIRST, mapping a malformed/empty JSON body to a 400
    // instead of letting request.json() reject into the outer catch (a 500).
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    // Validate the decoded body shape before trusting the `as` cast below: a
    // `null` body or a non-string `manifestYaml` would otherwise slip past the
    // size guard and reach the analyzer.
    const invalidBody = guardManifestBody(body);
    if (invalidBody) return invalidBody;
    const { manifestYaml } = body as ViolationsRequestBody;

    const tooLarge = guardManifestSize(manifestYaml);
    if (tooLarge) return tooLarge;

    const analysis = analyzeManifest(manifestYaml);
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
