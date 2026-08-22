import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { safeParseScanEnvelope } from "@hexagen/shared";
import { guardMutation } from "@/lib/request-guards";
import {
  openScanQuota,
  type ScanQuotaGate,
} from "@/lib/project-scan/scan-quota";
import { classifyScanExit } from "@/lib/project-scan/classify-scan-exit";
import {
  hexagenScanArgv,
  resolveHexagenBin,
} from "@/lib/project-scan/hexagen-bin";
import { findMonorepoRoot } from "@/lib/monorepo-root";
import {
  MAX_PROJECT_NAME_CHARS,
  MAX_SCAN_ERROR_CHARS,
  MAX_SCAN_LAYOUT_EXCERPT_CHARS,
  MAX_SCAN_REPORT_CHARS,
  SCAN_TIMEOUT_MS,
} from "@/lib/project-scan/limits";
import type { ProjectScanResponse } from "@/lib/project-scan/types";
import {
  cloneRepository,
  createCloneWorkspace,
  isGitHubScanEnabled,
  parseRepoReference,
  preflightRepository,
  type CloneProgress,
  type CloneWorkspace,
  type RepoReference,
  type RepoReferenceRejection,
} from "@/lib/project-scan/clone";
import { logger } from "../../../../../lib/structured-logger";

/**
 * POST /api/projects/scan/github — Tier B brownfield entry (F-09, packet
 * BF-5.2).
 *
 * Takes a PUBLIC GitHub repository reference, shallow-clones it into a
 * throwaway directory, runs `hexagen scan` over it, streams NDJSON progress,
 * and deletes everything.
 *
 * This is the most exposed surface in the brownfield arc: one anonymous request
 * makes the server fetch network content and run a subprocess. The bounding
 * lives in `app/lib/project-scan/clone.ts` — read its module doc before
 * changing anything here. What this file owns:
 *
 * - the kill switch (`BROWNFIELD_GITHUB_SCAN`, default OFF) as the FIRST
 *   statement, so an unconfigured deployment has no route at all;
 * - the gate order — kill switch, then same-origin + per-IP rate limit, then
 *   the daily scan quota, then validation, then the preflight, and only then
 *   the charge and the clone;
 * - the error surface: every failure is one of the F-35 codes, and the client
 *   never sees git's stderr, a filesystem path, or a hostname.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Clone budget (60s) + scan budget (45s) + headroom for cleanup and the final
 * frame. Deliberately larger than the sibling zip route's 60s because this
 * route does two bounded subprocess-length things, not one.
 */
export const maxDuration = 120;

/**
 * The tightest budget of the three scan routes. A clone is the only entry point
 * that costs OUTBOUND bandwidth as well as CPU and disk, so a flood here is
 * more expensive to the host than a flood of uploads.
 */
const GITHUB_SCAN_MUTATION_GUARD = {
  maxRequests: 3,
  windowMs: 60_000,
  keyPrefix: "project-scan-github",
} as const;

const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/** Cap on the CLI's captured stdio. Same figure the zip adapter uses. */
const MAX_SCAN_STDIO_BYTES = 16 * 1024 * 1024;
const MAXBUFFER_ERROR_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Error surface (F-35)                                                */
/* ------------------------------------------------------------------ */

/**
 * The F-35 codes this route can emit. No other string may appear in a `code`
 * field, and the route never writes a failure sentence of its own.
 */
type ScanErrorCode =
  | "clone_failed"
  | "repo_too_large"
  | "quota_exhausted"
  | "scan_could_not_run"
  | "timeout";

/**
 * One code -> one message. This is the route's local stand-in for F-35's
 * shared renderer, which does not exist as a module yet; it is keyed ONLY by
 * code (never by call site) precisely so extracting it later is mechanical.
 *
 * Every message is deliberately free of any server-side detail: no path, no
 * hostname, no git output, no token. Specificity for the user comes from the
 * machine-readable `reason` field, not from prose assembled at the failure
 * site.
 */
const ERROR_MESSAGES: Readonly<Record<ScanErrorCode, string>> = {
  clone_failed: "The repository could not be cloned.",
  repo_too_large: "That repository is too large to scan here.",
  quota_exhausted: "The free-tier scan limit for today has been reached.",
  scan_could_not_run: "The scan could not run on that repository.",
  timeout: "The scan exceeded its time budget and was stopped.",
};

/** HTTP status for a failure that happens BEFORE the stream opens. */
const ERROR_STATUS: Readonly<Record<ScanErrorCode, number>> = {
  clone_failed: 400,
  repo_too_large: 413,
  quota_exhausted: 429,
  scan_could_not_run: 500,
  timeout: 504,
};

interface ErrorFrame {
  type: "error";
  code: ScanErrorCode;
  message: string;
  /** Machine-readable discriminator. Data, not prose. */
  reason?: string;
  runId: string;
}

function errorFrame(
  code: ScanErrorCode,
  runId: string,
  reason?: string,
): ErrorFrame {
  return {
    type: "error",
    code,
    message: ERROR_MESSAGES[code],
    ...(reason === undefined ? {} : { reason }),
    runId,
  };
}

/** A single-frame NDJSON response, for failures that precede the stream. */
function ndjsonError(
  code: ScanErrorCode,
  runId: string,
  options: { reason?: string; status?: number; headers?: HeadersInit } = {},
): NextResponse {
  return new NextResponse(
    `${JSON.stringify(errorFrame(code, runId, options.reason))}\n`,
    {
      status: options.status ?? ERROR_STATUS[code],
      headers: { "Content-Type": NDJSON_CONTENT_TYPE, ...options.headers },
    },
  );
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  // Kill switch FIRST, before the rate limiter, the session cookie, or any
  // parsing. Read at call time from the live environment so it cannot be
  // snapshotted at module load and go stale (BF-6.3's idiom).
  //
  // 404, not 403: when the feature is off this endpoint does not exist, and a
  // probe learns nothing about whether it might be switched on elsewhere.
  if (!isGitHubScanEnabled(process.env)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Same-origin + per-IP rate limit. Shared platform guard, identical to the
  // two sibling scan routes — its 403/429 bodies are the platform's, not this
  // route's invented prose, which is why they are passed through unchanged.
  const gate = guardMutation(request, GITHUB_SCAN_MUTATION_GUARD);
  if (gate) return gate;

  const quota = openScanQuota(request);
  const runId = randomUUID();
  return quota.applyHeaders(await handleGithubScan(request, quota, runId));
}

async function handleGithubScan(
  request: NextRequest,
  quota: ScanQuotaGate,
  runId: string,
): Promise<NextResponse> {
  // Peek, not consume. Turns an exhausted caller away before any outbound
  // request is made on their behalf.
  const exhausted = quota.precheck();
  if (exhausted) return await quotaDenial(exhausted, runId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ndjsonError("clone_failed", runId, { reason: "invalid-body" });
  }
  if (typeof body !== "object" || body === null) {
    return ndjsonError("clone_failed", runId, { reason: "invalid-body" });
  }
  const fields = body as Record<string, unknown>;

  const nameField = fields.name;
  const projectName = typeof nameField === "string" ? nameField.trim() : "";
  if (projectName.length === 0 || projectName.length > MAX_PROJECT_NAME_CHARS) {
    return ndjsonError("clone_failed", runId, { reason: "invalid-name" });
  }

  // The single trust boundary for the repository reference. Nothing downstream
  // touches `fields.repoUrl` again.
  const parsed = parseRepoReference(fields.repoUrl, fields.ref);
  if (!parsed.ok) {
    logger.warn("[scan/github] rejected repository reference", {
      runId,
      reason: parsed.reason,
    });
    return ndjsonError("clone_failed", runId, {
      reason: rejectionReason(parsed.reason),
    });
  }
  const reference = parsed.reference;

  // Preflight BEFORE the charge: an oversized or unreachable repository must
  // not burn one of the caller's daily scans. It costs one anonymous GET to
  // api.github.com, and the per-IP limiter above bounds how often that can be
  // provoked.
  const preflight = await preflightRepository(reference);
  if (!preflight.ok) {
    logger.warn("[scan/github] preflight refused", {
      runId,
      code: preflight.code,
      // `detail` is log-only and never reaches the response body.
      detail: preflight.detail,
    });
    return ndjsonError(preflight.code, runId, { reason: "preflight" });
  }

  // Point of no return: below this line the server clones and executes. One
  // request, one charge; `charge()` memoizes so this cannot double-count.
  const denied = quota.charge();
  if (denied) return await quotaDenial(denied, runId);

  const resolved: RepoReference =
    reference.ref === null && preflight.defaultBranch !== null
      ? { ...reference, ref: preflight.defaultBranch }
      : reference;

  return streamScan({ request, reference: resolved, projectName, runId });
}

/**
 * Re-shape the quota gate's ready-made 429 into this route's NDJSON channel.
 *
 * The gate owns the copy (it names the real limit and the reset time), so the
 * message is REUSED rather than rewritten — the route adds the `quota_exhausted`
 * code and the NDJSON framing, and nothing else. Status, `Retry-After` and the
 * anonymous-session `Set-Cookie` are carried across verbatim.
 */
async function quotaDenial(
  denial: NextResponse,
  runId: string,
): Promise<NextResponse> {
  let message = ERROR_MESSAGES.quota_exhausted;
  try {
    const parsed: unknown = await denial.clone().json();
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { error?: unknown }).error === "string"
    ) {
      message = (parsed as { error: string }).error;
    }
  } catch {
    // Fall back to the taxonomy message.
  }
  const headers = new Headers(denial.headers);
  headers.set("Content-Type", NDJSON_CONTENT_TYPE);
  const frame: ErrorFrame = {
    type: "error",
    code: "quota_exhausted",
    message,
    runId,
  };
  return new NextResponse(`${JSON.stringify(frame)}\n`, {
    status: denial.status,
    headers,
  });
}

/** Rejection reason -> a stable, machine-readable wire token. */
function rejectionReason(reason: RepoReferenceRejection): string {
  return `reference-${reason}`;
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

const STAGE_CLONE = 0;
const STAGE_SCAN = 1;

interface StreamInput {
  request: NextRequest;
  reference: RepoReference;
  projectName: string;
  runId: string;
}

function streamScan(input: StreamInput): NextResponse {
  const encoder = new TextEncoder();
  const abort = new AbortController();

  // Client disconnect. Next.js aborts `request.signal` when the connection
  // drops on the Node runtime; the clone listens to it and dies with its whole
  // process group. NOTE the honest limit: if a deployment does NOT propagate
  // that abort, cleanup still happens, but only when the clone's own wall-clock
  // timer fires — the `finally` below is what guarantees the directory is
  // removed, not the disconnect handler.
  const onRequestAbort = () => abort.abort();
  if (input.request.signal.aborted) {
    abort.abort();
  } else {
    input.request.signal.addEventListener("abort", onRequestAbort, {
      once: true,
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (frame: object) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({ ...frame, runId: input.runId })}\n`,
            ),
          );
        } catch {
          // The consumer went away mid-write. Stop emitting, keep unwinding —
          // an enqueue failure must never skip the cleanup below.
          closed = true;
        }
      };

      const workspace: CloneWorkspace = await createCloneWorkspace();
      try {
        send({
          type: "stage-start",
          stage: STAGE_CLONE,
          label: "Clone",
          repo: `${input.reference.owner}/${input.reference.repo}`,
          ref: input.reference.ref,
        });

        const cloneStartedAt = Date.now();
        const clone = await cloneRepository({
          reference: input.reference,
          workspace,
          signal: abort.signal,
          onProgress: (progress: CloneProgress) => {
            // Real byte counts or none. `receivedBytes` is git's own figure and
            // is omitted when git printed none; nothing is ever derived from a
            // percentage.
            send({
              type: "chunk",
              stage: STAGE_CLONE,
              data: progress.line,
              ...(progress.receivedBytes === null
                ? {}
                : { receivedBytes: progress.receivedBytes }),
            });
          },
        });

        if (!clone.ok) {
          logger.warn("[scan/github] clone failed", {
            runId: input.runId,
            code: clone.code,
            detail: clone.detail,
          });
          // Terminal. No stage-complete, no artifacts — a failed clone has
          // produced nothing that could honestly be offered as a partial.
          send(errorFrame(clone.code, input.runId, "clone"));
          return;
        }

        send({
          type: "stage-complete",
          stage: STAGE_CLONE,
          durationMs: Date.now() - cloneStartedAt,
        });

        if (abort.signal.aborted) return;

        send({ type: "stage-start", stage: STAGE_SCAN, label: "Scan" });
        const scanStartedAt = Date.now();
        const scan = await runHexagenScan(workspace.repoDir, input.projectName);

        if (!scan.ok) {
          logger.warn("[scan/github] scan could not run", {
            runId: input.runId,
            code: scan.code,
            detail: scan.detail,
          });
          send(errorFrame(scan.code, input.runId, "scan"));
          return;
        }

        send({
          type: "stage-complete",
          stage: STAGE_SCAN,
          durationMs: Date.now() - scanStartedAt,
        });
        send({ type: "done", result: scan.result });
      } catch (error) {
        logger.error("[scan/github] unexpected failure", {
          runId: input.runId,
          error: error instanceof Error ? error.message : String(error),
        });
        send(errorFrame("scan_could_not_run", input.runId, "unexpected"));
      } finally {
        // THE cleanup guarantee. Runs on success, on a failed clone, on a
        // timeout kill, on an unexpected throw, and on an aborted stream —
        // every path out of `start` passes through here.
        await workspace.cleanup();
        input.request.signal.removeEventListener("abort", onRequestAbort);
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by a cancelled consumer.
        }
      }
    },
    cancel() {
      // The consumer cancelled. Abort the clone so the subprocess dies now
      // rather than at its wall-clock deadline; `start`'s `finally` still owns
      // the directory removal.
      abort.abort();
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": NDJSON_CONTENT_TYPE,
      "Cache-Control": "no-store, no-transform",
      // Long-lived proxied streams stall without this on nginx.
      "X-Accel-Buffering": "no",
    },
  });
}

/* ------------------------------------------------------------------ */
/* Scan                                                                */
/* ------------------------------------------------------------------ */

interface ScanFailure {
  ok: false;
  code: ScanErrorCode;
  detail: string;
}

type ScanOutcome = { ok: true; result: ProjectScanResponse } | ScanFailure;

interface ExecFailure extends Error {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  code?: number | string;
  killed?: boolean;
}

/**
 * Run `hexagen scan --yes --root <dir>` over the clone.
 *
 * Same argv discipline as the zip adapter: `execFile` with an argument array,
 * binary resolved from the monorepo root rather than `process.cwd()`, never a
 * shell string. The result is read from the versioned scan envelope
 * (`@hexagen/shared`), which BF-0.0 made the single contract between the CLI
 * and the web — deliberately WITHOUT the zip adapter's legacy file-probing
 * fallback, since probing for `layout.yaml` and three report filenames is a
 * second, unversioned contract that this route has no reason to inherit.
 */
async function runHexagenScan(
  repoDir: string,
  projectName: string,
): Promise<ScanOutcome> {
  const bin = resolveHexagenBin(findMonorepoRoot());
  if (bin === null) {
    return {
      ok: false,
      code: "scan_could_not_run",
      detail: "hexagen binary not found on the server",
    };
  }

  const { file, args } = hexagenScanArgv(bin, repoDir);
  let stdout = "";
  let exitCode: number | string | null = 0;

  try {
    const result = await execFileAsync(file, args, {
      cwd: repoDir,
      timeout: SCAN_TIMEOUT_MS,
      maxBuffer: MAX_SCAN_STDIO_BYTES,
      // Not `process.env`: the CLI has no business seeing this server's
      // secrets, and the clone step already established that discipline.
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: repoDir,
        NODE_ENV: process.env.NODE_ENV ?? "production",
      },
    });
    stdout = result.stdout;
  } catch (error) {
    const failure = error as ExecFailure;
    if (failure.code === MAXBUFFER_ERROR_CODE) {
      return {
        ok: false,
        code: "scan_could_not_run",
        detail: "scan output exceeded the stdio buffer",
      };
    }
    if (failure.killed === true) {
      return {
        ok: false,
        code: "timeout",
        detail: `scan exceeded ${SCAN_TIMEOUT_MS}ms`,
      };
    }
    stdout = failure.stdout ? String(failure.stdout) : "";
    exitCode = failure.code ?? null;
  }

  const verdict = classifyScanExit(exitCode);
  const envelope = readEnvelope(stdout);

  if (verdict === "could-not-run") {
    return {
      ok: false,
      code: "scan_could_not_run",
      // Log-only. The CLI's own message can name the clone directory.
      detail: envelope?.error ?? `hexagen scan exited ${String(exitCode)}`,
    };
  }

  return {
    ok: true,
    result: {
      verdict,
      exitCode: typeof exitCode === "number" ? exitCode : null,
      projectName,
      layoutExcerpt: clip(
        envelope?.layout ?? null,
        MAX_SCAN_LAYOUT_EXCERPT_CHARS,
      ),
      filesScanned: envelope?.filesScanned ?? null,
      reportMarkdown: clip(
        envelope?.reportMarkdown ?? null,
        MAX_SCAN_REPORT_CHARS,
      ),
      errorMessage: clip(envelope?.error ?? null, MAX_SCAN_ERROR_CHARS),
    },
  };
}

interface EnvelopeFields {
  layout: string | null;
  filesScanned: number | null;
  reportMarkdown: string | null;
  error: string | null;
}

/**
 * Read the envelope from the LAST `{`-prefixed stdout line — `hexagen scan`
 * prints human next-steps first and appends the envelope, so requiring stdout
 * to *begin* with `{` would never match the real CLI.
 */
function readEnvelope(stdout: string): EnvelopeFields | null {
  const line = stdout
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.startsWith("{"))
    .at(-1);
  if (line === undefined) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = safeParseScanEnvelope(raw);
  if (!parsed.success) return null;

  return {
    layout: parsed.data.layout ?? null,
    filesScanned: parsed.data.filesScanned ?? null,
    reportMarkdown: parsed.data.reportMarkdown ?? null,
    error: parsed.data.error ?? null,
  };
}

function clip(text: string | null, max: number): string | null {
  if (text === null || text.length === 0) return null;
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export async function GET() {
  // Mirrors POST: when the feature is off the endpoint does not exist at all,
  // so a GET probe cannot distinguish "disabled" from "never built".
  if (!isGitHubScanEnabled(process.env)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(
    { error: "Use POST with a GitHub repository reference" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
