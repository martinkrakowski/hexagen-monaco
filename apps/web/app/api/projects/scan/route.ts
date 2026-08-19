import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/request-guards";
import { CliHexagenScanAdapter } from "@/lib/project-scan/cli-hexagen-scan.adapter";
import {
  MAX_PROJECT_NAME_CHARS,
  MAX_SCAN_REQUEST_BYTES,
  MAX_SCAN_ZIP_BYTES,
} from "@/lib/project-scan/limits";
import { logger } from "../../../../lib/structured-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Zip uploads are expensive (unpack + CLI). Isolated, tight budget. */
const SCAN_MUTATION_GUARD = {
  maxRequests: 5,
  windowMs: 60_000,
  keyPrefix: "project-scan",
} as const;

/** Duck-type File: `instanceof File` fails across Node vs jsdom realms. */
function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).name === "string" &&
    typeof (value as File).size === "number"
  );
}

/**
 * Reject oversized bodies *before* `formData()` materializes the multipart
 * payload. Content-Length can be omitted (chunked); the zip-part size check
 * below still applies after parse. A present, non-numeric header is 400.
 */
function rejectOversizedRequest(request: NextRequest): NextResponse | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return NextResponse.json(
      { error: "Invalid Content-Length" },
      { status: 400 },
    );
  }
  if (Number(trimmed) > MAX_SCAN_REQUEST_BYTES) {
    return NextResponse.json(
      {
        error: `Request body is too large (exceeds ${MAX_SCAN_REQUEST_BYTES.toLocaleString()} bytes)`,
      },
      { status: 413 },
    );
  }
  return null;
}

function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) return true;
  const type = file.type.toLowerCase();
  return (
    type === "application/zip" ||
    type === "application/x-zip-compressed" ||
    type === "application/octet-stream"
  );
}

export async function POST(request: NextRequest) {
  const gate = guardMutation(request, SCAN_MUTATION_GUARD);
  if (gate) return gate;

  const oversized = rejectOversizedRequest(request);
  if (oversized) return oversized;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request body must be multipart form data" },
      { status: 400 },
    );
  }

  const nameField = form.get("name");
  const projectName = typeof nameField === "string" ? nameField.trim() : "";
  if (projectName.length === 0) {
    return NextResponse.json(
      { error: "Project name is required" },
      { status: 400 },
    );
  }
  if (projectName.length > MAX_PROJECT_NAME_CHARS) {
    return NextResponse.json(
      { error: `Project name exceeds ${MAX_PROJECT_NAME_CHARS} characters` },
      { status: 400 },
    );
  }

  const zipField = form.get("zip");
  if (!isUploadedFile(zipField) || zipField.size === 0) {
    return NextResponse.json(
      { error: "A zip file is required" },
      { status: 400 },
    );
  }
  if (!isZipFile(zipField)) {
    return NextResponse.json(
      { error: "Upload must be a .zip archive" },
      { status: 400 },
    );
  }
  if (zipField.size > MAX_SCAN_ZIP_BYTES) {
    return NextResponse.json(
      {
        error: `Zip is too large (exceeds ${MAX_SCAN_ZIP_BYTES.toLocaleString()} bytes)`,
      },
      { status: 400 },
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await zipField.arrayBuffer());
  } catch (err) {
    logger.error("Failed to read uploaded zip", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Could not read the uploaded zip" },
      { status: 400 },
    );
  }

  try {
    const adapter = CliHexagenScanAdapter.fromMonorepoRoot();
    const outcome = await adapter.scanZip({ zip: buffer, projectName });
    if (outcome.kind === "rejected") {
      return NextResponse.json(
        { error: outcome.message, reason: outcome.reason },
        { status: 400 },
      );
    }
    return NextResponse.json(outcome.result);
  } catch (err) {
    logger.error("Project scan failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        verdict: "could-not-run",
        exitCode: null,
        projectName,
        layoutExcerpt: null,
        filesScanned: null,
        reportMarkdown: null,
        errorMessage: "Unexpected error running hexagen scan.",
      },
      { status: 200 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with multipart zip and name" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
