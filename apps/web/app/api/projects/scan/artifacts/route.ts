import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/request-guards";
import {
  MAX_HANDOFF_LOOSE_FILES,
  MAX_HANDOFF_LOOSE_FILE_BYTES,
  MAX_HANDOFF_REQUEST_BYTES,
  MAX_HANDOFF_UPLOAD_BYTES,
  ingestHandoffFiles,
  ingestHandoffZip,
  type HandoffIngestOutcome,
} from "@/lib/project-scan/artifact-parse";
import { MAX_PROJECT_NAME_CHARS } from "@/lib/project-scan/limits";
import { logger } from "../../../../../lib/structured-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Tier A parses a handful of small text files in-process — no subprocess, no
 * network. A short budget is honest here; the sibling scan route needs 60s only
 * because it spawns the CLI.
 */
export const maxDuration = 30;

/**
 * Own rate-limit namespace. Cheaper than the Tier-B scan (no exec), so a larger
 * budget — but still isolated, so a handoff flood cannot exhaust the scan
 * budget or vice versa.
 */
const HANDOFF_MUTATION_GUARD = {
  maxRequests: 15,
  windowMs: 60_000,
  keyPrefix: "project-scan-artifacts",
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
 * payload. Content-Length can be omitted (chunked); the per-part size checks
 * below still apply after parse. A present, non-numeric header is 400.
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
  if (Number(trimmed) > MAX_HANDOFF_REQUEST_BYTES) {
    return NextResponse.json(
      {
        error: `Request body is too large (exceeds ${MAX_HANDOFF_REQUEST_BYTES.toLocaleString()} bytes)`,
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

/**
 * POST /api/projects/scan/artifacts — Tier-A handoff ingest (F-07).
 *
 * The user ran `hexagen scan --handoff` on their own machine; this route parses
 * the artifacts and **executes nothing**. No CLI is spawned, so the route does
 * not depend on a hexagen binary being present in the production image (the
 * D-P1 blocker), and no source code is uploaded.
 *
 * Accepts either a `zip` part (the handoff zip) or loose artifact file parts.
 */
export async function POST(request: NextRequest) {
  const gate = guardMutation(request, HANDOFF_MUTATION_GUARD);
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
  const hasZip = isUploadedFile(zipField) && zipField.size > 0;

  if (hasZip) {
    const zip = zipField as File;
    if (!isZipFile(zip)) {
      return NextResponse.json(
        { error: "Upload must be a .zip archive" },
        { status: 400 },
      );
    }
    if (zip.size > MAX_HANDOFF_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Handoff zip is too large (exceeds ${MAX_HANDOFF_UPLOAD_BYTES.toLocaleString()} bytes)`,
        },
        { status: 400 },
      );
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(await zip.arrayBuffer());
    } catch (err) {
      logger.error("Failed to read uploaded handoff zip", {
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: "Could not read the uploaded zip" },
        { status: 400 },
      );
    }

    return respond(await ingestHandoffZip({ zip: buffer, projectName }));
  }

  // Loose-file mode: every non-`name` file part is a candidate artifact.
  const loose: { name: string; content: Buffer }[] = [];
  for (const [field, value] of form.entries()) {
    if (field === "name") continue;
    if (!isUploadedFile(value) || value.size === 0) continue;
    if (loose.length >= MAX_HANDOFF_LOOSE_FILES) {
      return NextResponse.json(
        {
          error: `Too many files (at most ${MAX_HANDOFF_LOOSE_FILES} handoff artifacts)`,
        },
        { status: 400 },
      );
    }
    if (value.size > MAX_HANDOFF_LOOSE_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `${value.name} is too large (exceeds ${MAX_HANDOFF_LOOSE_FILE_BYTES.toLocaleString()} bytes)`,
        },
        { status: 400 },
      );
    }
    try {
      loose.push({
        name: value.name,
        content: Buffer.from(await value.arrayBuffer()),
      });
    } catch (err) {
      logger.error("Failed to read uploaded handoff artifact", {
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: "Could not read an uploaded artifact" },
        { status: 400 },
      );
    }
  }

  if (loose.length === 0) {
    return NextResponse.json(
      {
        error:
          "Upload the zip produced by `hexagen scan --handoff`, or its artifact files.",
      },
      { status: 400 },
    );
  }

  return respond(ingestHandoffFiles({ files: loose, projectName }));
}

/**
 * Outcome → HTTP. `rejected` is always 400: every rejection reason describes a
 * bad or crafted upload, and a crafted archive must never read as a 500 or as a
 * soft "could not run". `failed` is a genuine server-side fault (temp-dir
 * creation, unreadable staging) and is reported as 500 rather than dressed up
 * as a successful-but-empty parse.
 */
function respond(outcome: HandoffIngestOutcome): NextResponse {
  if (outcome.kind === "rejected") {
    return NextResponse.json(
      { error: outcome.message, reason: outcome.reason },
      { status: 400 },
    );
  }
  if (outcome.kind === "failed") {
    logger.error("Handoff artifact ingest failed", { error: outcome.message });
    return NextResponse.json(
      { error: "Could not parse the uploaded handoff artifacts." },
      { status: 500 },
    );
  }
  return NextResponse.json(outcome.result);
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with multipart handoff artifacts and name" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
