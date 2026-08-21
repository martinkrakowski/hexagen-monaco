import { NextRequest, NextResponse } from "next/server";
import {
  JsZipCreatorAdapter,
  Project,
  hexagenGateBundleFiles,
} from "@hexagen/project-generation";
import { guardMutation } from "@/lib/request-guards";
import { logger } from "../../../../lib/structured-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Building the bundle is pure in-memory zipping of compiled-in constants — far
 * cheaper than `/api/projects/scan` — but it is still a POST that allocates a
 * few hundred KB, so it gets its own namespaced budget rather than sharing the
 * generic mutation family.
 */
const INSTALL_GATE_MUTATION_GUARD = {
  maxRequests: 20,
  windowMs: 60_000,
  keyPrefix: "install-gate",
} as const;

/** The JSON body is two short fields; anything larger is not a real client. */
const MAX_INSTALL_GATE_REQUEST_BYTES = 4 * 1024;

/**
 * `scanId` is echoed into the download filename, so it is validated against an
 * allow-list rather than escaped. That closes header injection through
 * `Content-Disposition` (CR/LF, quotes) and path traversal in one rule, and it
 * matches the shape of every id this app mints.
 */
const SCAN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Delivery modes for the gate.
 *
 * `"zip"` is the download — the real close for a client engagement: the
 * consultant applies the bundle and opens the PR inside the client's own
 * review process. It works anonymously.
 *
 * `"pr"` (branch + PR through the OAuth publish plumbing) is deliberately NOT
 * implemented here. It is gated on decision D-U3, because the `repo` scope is
 * all-repos read/write and no consultant should attach a personal grant
 * spanning client repositories. Named in the union so the route answers "not
 * yet" explicitly instead of "unknown mode".
 */
const INSTALL_GATE_MODES = ["zip", "pr"] as const;
type InstallGateMode = (typeof INSTALL_GATE_MODES)[number];

interface InstallGateRequest {
  readonly scanId?: unknown;
  readonly mode?: unknown;
}

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
  if (Number(trimmed) > MAX_INSTALL_GATE_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Request body is too large" },
      { status: 413 },
    );
  }
  return null;
}

function isInstallGateMode(value: unknown): value is InstallGateMode {
  return (
    typeof value === "string" &&
    (INSTALL_GATE_MODES as readonly string[]).includes(value)
  );
}

/**
 * Build the leave-behind bundle for a scan.
 *
 * The bundle is currently scan-independent by construction: it is the CI gate
 * itself (workflow + vendored composite action) plus the D-B4 install doc, all
 * compiled-in constants shared byte-for-byte with the greenfield generator.
 * The ratified `.architecture/{manifest,layout,arch-lint-baseline}` files that
 * will also ship in it come from the ratification/bootstrap screens, which do
 * not exist yet — and no `ScanRecord` store exists to look `scanId` up in. So
 * `scanId` is carried for correlation and for naming the download, and this
 * route does NOT pretend to validate it against a store it does not have.
 */
export async function POST(request: NextRequest) {
  const gate = guardMutation(request, INSTALL_GATE_MUTATION_GUARD);
  if (gate) return gate;

  const oversized = rejectOversizedRequest(request);
  if (oversized) return oversized;

  let body: InstallGateRequest;
  try {
    body = (await request.json()) as InstallGateRequest;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }

  const scanId = typeof body.scanId === "string" ? body.scanId.trim() : "";
  if (scanId.length === 0) {
    return NextResponse.json({ error: "scanId is required" }, { status: 400 });
  }
  if (!SCAN_ID_PATTERN.test(scanId)) {
    return NextResponse.json(
      {
        error:
          "scanId may contain only letters, digits, dot, underscore and hyphen (max 64)",
      },
      { status: 400 },
    );
  }

  if (body.mode !== undefined && !isInstallGateMode(body.mode)) {
    return NextResponse.json(
      { error: `mode must be one of: ${INSTALL_GATE_MODES.join(", ")}` },
      { status: 400 },
    );
  }
  const mode: InstallGateMode = isInstallGateMode(body.mode)
    ? body.mode
    : "zip";

  if (mode === "pr") {
    return NextResponse.json(
      {
        error:
          "Opening a pull request is not available yet. Download the zip and apply it inside your own review process.",
        reason: "mode-not-implemented",
      },
      { status: 501 },
    );
  }

  const files = new Map<string, string>(
    hexagenGateBundleFiles().map((file) => [file.path, file.content]),
  );

  const project = Project.create({
    id: scanId,
    name: `hexagen-gate-${scanId}`,
    rootName: `hexagen-gate-${scanId}`,
    files,
  });

  const zipped = await new JsZipCreatorAdapter().createZip(project);
  if (!zipped.success) {
    logger.error("Install-gate bundle could not be zipped", {
      scanId,
      code: zipped.error.code,
      error: zipped.error.message,
    });
    return NextResponse.json(
      { error: "Could not build the gate bundle" },
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(zipped.value), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="hexagen-gate-${scanId}.zip"`,
      // The bundle is generated per request from compiled-in constants; a
      // cached copy would survive a toolchain-contract bump.
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with { scanId, mode }" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
