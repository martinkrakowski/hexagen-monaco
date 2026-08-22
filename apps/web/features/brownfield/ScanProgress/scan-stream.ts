import { SCAN_TIMEOUT_MS } from "@/lib/project-scan/limits";
import type {
  ProjectScanResponse,
  ScanVerdict,
} from "@/lib/project-scan/types";

/**
 * S2 — the pure half of the Tier-B streaming scan screen (F-16, packet BF-5.3).
 *
 * No React, no `fetch`, no timers. Everything the screen shows is computed
 * here from the NDJSON frames `POST /api/projects/scan/github` (BF-5.2) emits,
 * so the whole protocol — including every failure shape — is testable without
 * a DOM or a network stub. `useGithubScan.ts` owns the transport and does
 * nothing but feed this module; `ScanProgressView.tsx` renders what it returns.
 *
 * Three rules are encoded structurally here rather than left to the view:
 *
 * 1. **No synthetic percentages.** `receivedBytes` is git's own figure, and the
 *    route omits it whenever git printed none. This module never divides,
 *    scales, or interpolates one — {@link ScanStageProgress.receivedBytes} is
 *    `null` until a real figure arrives, and the view draws nothing for null.
 *    There is deliberately no "fraction" or "percent" field anywhere below.
 * 2. **A failed clone is terminal.** {@link applyScanFrame} moves the run to
 *    `blocked` on an `error` frame and refuses every later frame, so a stream
 *    that keeps talking after a failure cannot resurrect a partial success.
 * 3. **No invented failure prose.** The route emits a `code` from a CLOSED
 *    SET; {@link describeScanFailure} is the ONE place a code becomes copy, and
 *    an unrecognised code produces an honest generic sentence rather than a
 *    guess. The route's own `message` is preferred over anything written here
 *    wherever it exists, because it is the authority (it names the real quota
 *    limit and reset time) and a paraphrase would rot the first time it changes.
 *
 * ## Prop/field naming
 *
 * None of the eleven forbidden information-state names
 * (`data`, `loading`, `error`, `result`, `isFetching`, `isPending`,
 * `isSuccess`, `isError`, `governance`, `llm`, `status`) is declared in this
 * module or in the view that consumes it. The wire carries `data` on a `chunk`
 * frame and `result` on a `done` frame; both are read off an untyped
 * `Record<string, unknown>` at the parse boundary and re-published as `line`
 * and `outcome`. `StageProgressList`'s own `status` prop is supplied as an
 * object-literal key at the call site, from {@link ScanStageProgress.phase}.
 */

/* ------------------------------------------------------------------ */
/* The wire vocabulary                                                 */
/* ------------------------------------------------------------------ */

/**
 * The F-35 codes the route can emit, verbatim from its `ScanErrorCode` union.
 * Mirrored rather than imported because the route module pulls in
 * `node:child_process` (through `clone.ts`) and cannot enter a client bundle.
 * {@link isScanErrorCode} is the only place the set is consulted, and an
 * unlisted code is handled as `"unknown"` — never dropped, never guessed.
 */
export const SCAN_ERROR_CODES = [
  "clone_failed",
  "repo_too_large",
  "quota_exhausted",
  "scan_could_not_run",
  "timeout",
] as const;

export type ScanErrorCode = (typeof SCAN_ERROR_CODES)[number];

export function isScanErrorCode(value: unknown): value is ScanErrorCode {
  return (
    typeof value === "string" &&
    (SCAN_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** Stage indices the route uses. `STAGE_CLONE = 0`, `STAGE_SCAN = 1`. */
export const STAGE_CLONE = 0;
export const STAGE_SCAN = 1;

/**
 * The two stages the route actually emits, seeded up front so the user sees
 * what is coming rather than watching rows appear one at a time.
 *
 * The S2 wireframe in the feature plan shows FOUR rows (Clone / Detect
 * workspaces / Lint / Report). That predates BF-5.2, which runs detect, lint
 * and report inside a single `hexagen scan` subprocess and therefore reports
 * them as one stage. Seeding the wireframe's four rows would draw two stages
 * that no frame will ever complete — a fabricated progress list, which is the
 * same defect class as a fabricated percentage. Rows are seeded from the
 * protocol, and an unrecognised stage index is appended when it arrives.
 */
const SEEDED_STAGES: ReadonlyArray<{ stage: number; label: string }> = [
  { stage: STAGE_CLONE, label: "Clone" },
  { stage: STAGE_SCAN, label: "Scan" },
];

/**
 * Per-stage log cap. The route bounds each line's LENGTH but not the number of
 * lines, and `Receiving objects:` alone can emit hundreds on a large clone. An
 * unbounded array is a memory leak the server can drive, so the oldest lines
 * are dropped and the view says so.
 */
export const MAX_STAGE_LOG_LINES = 200;

/** A frame this module understands, normalised away from the wire's names. */
export type ScanFrame =
  | {
      readonly kind: "stage-start";
      readonly stage: number;
      readonly label: string;
      readonly repo: string | null;
      readonly ref: string | null;
      readonly runId: string | null;
    }
  | {
      readonly kind: "chunk";
      readonly stage: number;
      /** The wire calls this `data`. Renamed at the boundary — see the docblock. */
      readonly line: string;
      /** Git's own byte figure, or `null` when git printed none. */
      readonly receivedBytes: number | null;
      readonly runId: string | null;
    }
  | {
      readonly kind: "stage-complete";
      readonly stage: number;
      readonly durationMs: number | null;
      readonly runId: string | null;
    }
  | {
      readonly kind: "done";
      /** The wire calls this `result`. Renamed at the boundary. */
      readonly outcome: ProjectScanResponse;
      readonly runId: string | null;
    }
  | {
      readonly kind: "failure";
      /** A member of the closed set, or `"unknown"` for anything else. */
      readonly code: ScanErrorCode | "unknown";
      /** Exactly what arrived, kept for the log and for bug reports. */
      readonly rawCode: string;
      readonly message: string | null;
      readonly reason: string | null;
      readonly runId: string | null;
    };

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const VERDICTS: readonly ScanVerdict[] = [
  "pass",
  "violations",
  "could-not-run",
];

/**
 * Guard for the `done` frame's payload.
 *
 * It checks every field the result panel DEREFERENCES, not merely that the
 * payload is an object — the same rule `isHandoffResponse` in
 * `BrownfieldImportPage.tsx` was fixed to follow. A 200 with an unexpected
 * shape must become a message, not a TypeError thrown during render.
 */
export function isProjectScanResponse(
  value: unknown,
): value is ProjectScanResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    VERDICTS.includes(record.verdict as ScanVerdict) &&
    (record.exitCode === null || typeof record.exitCode === "number") &&
    typeof record.projectName === "string" &&
    (record.layoutExcerpt === null ||
      typeof record.layoutExcerpt === "string") &&
    (record.filesScanned === null || typeof record.filesScanned === "number") &&
    (record.reportMarkdown === null ||
      typeof record.reportMarkdown === "string") &&
    (record.errorMessage === null || typeof record.errorMessage === "string")
  );
}

/**
 * Parse ONE NDJSON line into a frame, or `null` for anything unusable.
 *
 * `null` means "ignore this line", and that is the right answer for a blank
 * line, a heartbeat a future proxy inserts, or a frame type this build does
 * not know. It is emphatically NOT the answer for a malformed `done` — that is
 * turned into a `failure` frame, because silently ignoring it would leave the
 * run streaming forever against a stream that has already ended.
 */
export function parseScanFrame(rawLine: string): ScanFrame | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const runId = optionalString(record.runId);

  switch (record.type) {
    case "stage-start": {
      const stage = finiteNumber(record.stage);
      if (stage === null) return null;
      return {
        kind: "stage-start",
        stage,
        label: optionalString(record.label) ?? `Stage ${stage}`,
        repo: optionalString(record.repo),
        ref: optionalString(record.ref),
        runId,
      };
    }
    case "chunk": {
      const stage = finiteNumber(record.stage);
      const line = optionalString(record.data);
      if (stage === null || line === null) return null;
      // Absent `receivedBytes` is the route SAYING git printed no figure. It
      // stays absent; nothing here fills the gap.
      const receivedBytes = finiteNumber(record.receivedBytes);
      return {
        kind: "chunk",
        stage,
        line,
        receivedBytes:
          receivedBytes !== null && receivedBytes >= 0 ? receivedBytes : null,
        runId,
      };
    }
    case "stage-complete": {
      const stage = finiteNumber(record.stage);
      if (stage === null) return null;
      return {
        kind: "stage-complete",
        stage,
        durationMs: finiteNumber(record.durationMs),
        runId,
      };
    }
    case "done": {
      if (!isProjectScanResponse(record.result)) {
        return {
          kind: "failure",
          code: "unknown",
          rawCode: "malformed-done",
          message: null,
          reason: "malformed-done",
          runId,
        };
      }
      return { kind: "done", outcome: record.result, runId };
    }
    case "error": {
      const rawCode = optionalString(record.code) ?? "";
      return {
        kind: "failure",
        code: isScanErrorCode(rawCode) ? rawCode : "unknown",
        rawCode,
        message: optionalString(record.message),
        reason: optionalString(record.reason),
        runId,
      };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Run state                                                           */
/* ------------------------------------------------------------------ */

/** One stage row. `phase` is this module's word; it is never `status`. */
export interface ScanStageProgress {
  readonly stage: number;
  readonly label: string;
  readonly phase: "waiting" | "running" | "done";
  readonly durationMs: number | null;
  /** Newest last, capped at {@link MAX_STAGE_LOG_LINES}. */
  readonly lines: readonly string[];
  /** True once the cap dropped a line, so the view can say the log is clipped. */
  readonly clipped: boolean;
  /** The latest REAL byte figure git printed, or `null`. Never derived. */
  readonly receivedBytes: number | null;
}

/** Finished copy for a stopped run. Assembled once, in one place. */
export interface ScanFailureCopy {
  /** One short sentence naming what happened. */
  readonly title: string;
  /** What the server actually said, or the honest equivalent. */
  readonly detail: string;
  /** What to do next. */
  readonly hint: string;
  /** Carried for the log line and for bug reports; never rendered as prose. */
  readonly code: string;
}

export interface ScanRun {
  /**
   * `cancelled` is the user's own act and is NOT a failure — it is kept
   * distinct so the screen never tells someone their scan broke when they
   * stopped it.
   */
  readonly phase: "idle" | "streaming" | "blocked" | "complete" | "cancelled";
  readonly runId: string | null;
  /** `owner/repo @ ref`, echoed back from the first `stage-start` frame. */
  readonly repoLabel: string | null;
  readonly stages: readonly ScanStageProgress[];
  readonly failure: ScanFailureCopy | null;
  /** The `done` payload. Non-null ONLY on `phase === "complete"`. */
  readonly outcome: ProjectScanResponse | null;
}

export function initialScanRun(): ScanRun {
  return {
    phase: "idle",
    runId: null,
    repoLabel: null,
    stages: SEEDED_STAGES.map((seed) => ({
      stage: seed.stage,
      label: seed.label,
      phase: "waiting" as const,
      durationMs: null,
      lines: [],
      clipped: false,
      receivedBytes: null,
    })),
    failure: null,
    outcome: null,
  };
}

/** The state a run is in the instant the request is sent. */
export function startedScanRun(): ScanRun {
  return { ...initialScanRun(), phase: "streaming" };
}

/** True once nothing more can change the run. */
export function isRunSettled(run: ScanRun): boolean {
  return (
    run.phase === "blocked" ||
    run.phase === "complete" ||
    run.phase === "cancelled"
  );
}

function withStage(
  run: ScanRun,
  stage: number,
  labelHint: string,
  update: (current: ScanStageProgress) => ScanStageProgress,
): ScanRun {
  const index = run.stages.findIndex((entry) => entry.stage === stage);
  if (index === -1) {
    // An index the protocol did not seed. Appended rather than dropped: a
    // silently ignored stage is a stage the user watches never happen.
    const seeded: ScanStageProgress = {
      stage,
      label: labelHint,
      phase: "waiting",
      durationMs: null,
      lines: [],
      clipped: false,
      receivedBytes: null,
    };
    return {
      ...run,
      stages: [...run.stages, update(seeded)].sort((a, b) => a.stage - b.stage),
    };
  }
  const next = [...run.stages];
  next[index] = update(next[index]);
  return { ...run, stages: next };
}

function appendLine(
  current: ScanStageProgress,
  line: string,
): Pick<ScanStageProgress, "lines" | "clipped"> {
  const lines = [...current.lines, line];
  if (lines.length <= MAX_STAGE_LOG_LINES) {
    return { lines, clipped: current.clipped };
  }
  return { lines: lines.slice(-MAX_STAGE_LOG_LINES), clipped: true };
}

/**
 * Fold one frame into the run.
 *
 * A settled run is IMMUTABLE here. That is what makes "a failed clone is
 * terminal" a property rather than a convention: if the server (or a proxy
 * replaying a buffer) keeps sending `stage-complete` and `done` after an
 * `error`, none of it lands, and the screen cannot fall through to a partial
 * success.
 */
export function applyScanFrame(run: ScanRun, frame: ScanFrame): ScanRun {
  if (isRunSettled(run)) return run;

  const withRunId: ScanRun =
    run.runId === null && frame.runId !== null
      ? { ...run, runId: frame.runId }
      : run;

  switch (frame.kind) {
    case "stage-start": {
      const labelled = withStage(
        withRunId,
        frame.stage,
        frame.label,
        (current) => ({
          ...current,
          label: frame.label || current.label,
          phase: "running",
        }),
      );
      const repoLabel =
        frame.repo === null
          ? labelled.repoLabel
          : frame.ref === null
            ? frame.repo
            : `${frame.repo} @ ${frame.ref}`;
      return { ...labelled, phase: "streaming", repoLabel };
    }
    case "chunk":
      return withStage(
        withRunId,
        frame.stage,
        `Stage ${frame.stage}`,
        (current) => ({
          ...current,
          phase: current.phase === "done" ? current.phase : "running",
          ...appendLine(current, frame.line),
          // Only a real figure replaces the previous one. A `null` leaves the
          // last known REAL total standing rather than blanking the display.
          receivedBytes: frame.receivedBytes ?? current.receivedBytes,
        }),
      );
    case "stage-complete":
      return withStage(
        withRunId,
        frame.stage,
        `Stage ${frame.stage}`,
        (current) => ({
          ...current,
          phase: "done",
          durationMs: frame.durationMs,
        }),
      );
    case "done":
      return {
        ...withRunId,
        phase: "complete",
        outcome: frame.outcome,
        // Any stage still marked running when `done` arrives did finish — the
        // route emits `stage-complete` before `done` — but a dropped frame
        // must not leave a spinner running under a finished result.
        stages: withRunId.stages.map((entry) =>
          entry.phase === "running" ? { ...entry, phase: "done" } : entry,
        ),
      };
    case "failure":
      return {
        ...withRunId,
        phase: "blocked",
        // No artifacts on a blocked run, ever. The plan's state table says a
        // failed clone yields "blocked, no artifacts"; clearing it here means
        // no later reader has to remember.
        outcome: null,
        failure: describeScanFailure(frame, activeStageOf(withRunId)),
      };
  }
}

/** The stage a failure arrived on, used only to sharpen the copy. */
function activeStageOf(run: ScanRun): number | null {
  const running = run.stages.find((entry) => entry.phase === "running");
  return running?.stage ?? null;
}

/** How a stream stopped when no terminal frame explained it. */
export type ScanStreamEnding =
  | { readonly kind: "eof" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "transport"; readonly detail: string | null }
  | { readonly kind: "silent"; readonly afterMs: number };

/**
 * Settle a run whose reader stopped without a `done` or `error` frame.
 *
 * A well-formed stream always ends with one of those two. When it does not —
 * the connection dropped mid-clone, a proxy closed it, the serverless function
 * hit its own ceiling — the honest answer is that the run is over and produced
 * nothing, NOT that it is still going. The old failure mode this exists to
 * prevent is a screen parked on a pulsing dot forever.
 *
 * The quota note is deliberate and is not padding: the route charges the
 * caller's daily scan BEFORE it clones, so an interrupted run really has cost
 * one. Saying so is the difference between an explanation and a shrug.
 */
export function finishScanRun(run: ScanRun, ending: ScanStreamEnding): ScanRun {
  if (isRunSettled(run)) return run;
  if (ending.kind === "cancelled") {
    return { ...run, phase: "cancelled", outcome: null };
  }

  const detail =
    ending.kind === "transport"
      ? (ending.detail ??
        "The connection to the server failed before the scan finished.")
      : ending.kind === "silent"
        ? `The server sent nothing for ${Math.round(ending.afterMs / 1000)} seconds. Its own budget for a scan is shorter than that, so the connection is no longer alive.`
        : "The connection ended before the scan reported a result.";

  return {
    ...run,
    phase: "blocked",
    outcome: null,
    failure: {
      title: "The scan stopped before it finished",
      detail,
      hint: "Nothing was kept on the server, and no artifacts were produced. This run still counted against today's scan limit, because the limit is charged before the clone starts.",
      code: `stream-${ending.kind}`,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Failure copy — the ONE code-to-message map                          */
/* ------------------------------------------------------------------ */

/**
 * Hints keyed by the route's machine-readable `reason` token, which is data
 * rather than prose and is therefore safe to switch on. `reference-*` comes
 * from `parseRepoReference`'s rejection union; the rest are the route's own
 * call-site markers.
 */
const CLONE_FAILED_HINTS: Readonly<Record<string, string>> = {
  "reference-missing":
    "Enter a repository as `owner/repo`, or paste its github.com URL.",
  "reference-not-github":
    "Only github.com repositories can be scanned here. Paste a github.com URL, or use `owner/repo`.",
  "reference-malformed":
    "That did not parse as a repository. Use `owner/repo`, or a URL of the form https://github.com/owner/repo.",
  "reference-bad-owner":
    "The owner part is not a valid GitHub account name — letters, digits and single hyphens only.",
  "reference-bad-repo":
    "The repository part is not a valid GitHub repository name.",
  "reference-bad-ref":
    "That branch or tag name was refused. Leave it blank to use the repository's default branch.",
  "invalid-name":
    "Give the project a name of 1 to 100 characters and try again.",
  "invalid-body":
    "The request did not reach the server intact. Try again from a freshly loaded page.",
  preflight:
    "The repository has to be PUBLIC and it has to exist. A private repository, a typo, or a repository that has been renamed all land here.",
  clone:
    "The clone itself failed. Public repositories only — an empty repository, a branch that does not exist, or a repository that disappeared mid-clone all land here.",
};

const CLONE_FAILED_FALLBACK_HINT =
  "Check the owner, repository and branch, and that the repository is public.";

const OTHER_TIERS_HINT =
  "Run `npx hexagen scan --handoff` on your own machine and upload the handoff zip instead — that tier has no size limit here and never sends your source.";

/**
 * Turn a failure frame into finished copy. **This is the only place a code
 * becomes a sentence.**
 *
 * The route's own `message` is used as the detail wherever it exists, for the
 * reason its docblock gives: it is written at the authority (the quota gate
 * names the real limit and the real reset time) and a paraphrase here would
 * silently rot the first time that copy changes. What this function adds is
 * the TITLE and the HINT — what to do next — which the route deliberately does
 * not send.
 *
 * `activeStage` sharpens exactly one case: a `timeout` during the scan stage
 * can name the real budget, because `SCAN_TIMEOUT_MS` is a client-safe
 * constant shared with the route. The clone budget lives in `clone.ts`, which
 * cannot enter a client bundle, so a clone-stage timeout says "the server's
 * budget" and names no number rather than inventing one.
 */
export function describeScanFailure(
  frame: Extract<ScanFrame, { kind: "failure" }>,
  activeStage: number | null = null,
): ScanFailureCopy {
  const message = frame.message;
  const code = frame.rawCode.length > 0 ? frame.rawCode : "unspecified";

  switch (frame.code) {
    case "clone_failed":
      return {
        title: "That repository could not be cloned",
        detail: message ?? "The repository could not be cloned.",
        hint:
          (frame.reason === null
            ? undefined
            : CLONE_FAILED_HINTS[frame.reason]) ?? CLONE_FAILED_FALLBACK_HINT,
        code,
      };
    case "repo_too_large":
      return {
        title: "That repository is too large to scan here",
        detail:
          message ??
          "The repository exceeds the size this server will clone for an anonymous scan.",
        hint: OTHER_TIERS_HINT,
        code,
      };
    case "quota_exhausted":
      return {
        title: "Today's scan limit has been reached",
        // The gate's message names the actual limit and when it resets.
        detail:
          message ?? "The free-tier scan limit for today has been reached.",
        hint: "The limit resets at midnight UTC. Installing the hexagen CLI and running `hexagen scan` locally has no limit at all.",
        code,
      };
    case "scan_could_not_run":
      return {
        title: "The scan could not run on that repository",
        detail:
          message ??
          "The repository was cloned, but `hexagen scan` could not complete on it.",
        hint: `Nothing was kept. ${OTHER_TIERS_HINT}`,
        code,
      };
    case "timeout":
      return {
        title: "The scan ran out of time",
        detail:
          activeStage === STAGE_SCAN
            ? `The scan exceeded its ${Math.round(SCAN_TIMEOUT_MS / 1000)}-second budget and was stopped.`
            : (message ??
              "The run exceeded the server's time budget and was stopped."),
        hint: OTHER_TIERS_HINT,
        code,
      };
    case "unknown":
      // Deliberately generic. The route emits a closed set, so an unrecognised
      // code means this build of the app and the API disagree — and guessing
      // which failure it "probably" was is exactly what must not happen.
      return {
        title: "The scan stopped",
        detail:
          message ??
          "The server reported a failure it did not explain, so there is nothing more specific to show.",
        hint: "Try again. If it keeps happening, this build of the app and the API are out of step — quote the run id below in a bug report.",
        code,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Failures that happen BEFORE the stream opens                        */
/* ------------------------------------------------------------------ */

/**
 * The kill switch is OFF by default (`BROWNFIELD_GITHUB_SCAN`), and when it is
 * off the route answers 404 — the endpoint does not exist. "Not available" is
 * the truth; "something went wrong" is not, and neither is a retry button.
 *
 * Exported so the availability probe and the POST handler produce the SAME
 * copy: those are two ways of learning one fact, and they must not disagree.
 */
export function describeUnavailable(): ScanFailureCopy {
  return {
    title: "Scanning a GitHub repository is not available here",
    detail:
      "This deployment does not run the GitHub scan endpoint, so there is nothing to connect to. It is switched off, not broken.",
    hint: "The other two import tiers work everywhere: upload the handoff zip from `npx hexagen scan --handoff`, or upload a zip of the repository.",
    code: "not-enabled",
  };
}

/**
 * Copy for a non-200 response, i.e. a failure that happened before any stream
 * existed.
 *
 * The route answers most pre-stream failures with a SINGLE NDJSON error frame,
 * so `frame` carries it when the body parsed as one. Two statuses do not,
 * because they come from the shared platform guard rather than from the route:
 * `guardMutation`'s 403 (same-origin) and its per-IP 429, both plain JSON with
 * no `code`. Those are distinguished here by the ABSENCE of a frame, which is
 * also how a caller tells the per-IP 429 apart from the daily-quota 429 that
 * does carry `code: "quota_exhausted"`.
 */
export function describePreStreamFailure(
  httpStatus: number,
  frame: Extract<ScanFrame, { kind: "failure" }> | null,
  retryAfter: string | null,
): ScanFailureCopy {
  if (httpStatus === 404) return describeUnavailable();
  if (frame !== null) return describeScanFailure(frame);

  if (httpStatus === 403) {
    return {
      title: "The scan was not accepted from this page",
      detail:
        "The server rejected the request because it did not appear to come from this site.",
      hint: "Reload this page from the app's own address and try again. Nothing was cloned.",
      code: "http-403",
    };
  }
  if (httpStatus === 429) {
    return {
      title: "Too many scans in a short time",
      detail:
        "This endpoint accepts a small number of scans per minute from one address, because each one costs the server a clone.",
      hint: formatRetryHint(retryAfter),
      code: "http-429",
    };
  }
  if (httpStatus >= 500) {
    return {
      title: "The server failed before the scan started",
      detail: "The request never got as far as cloning anything.",
      hint: "Nothing was kept. Try again in a moment.",
      code: `http-${httpStatus}`,
    };
  }
  return {
    title: "The scan could not be started",
    detail: `The server answered with HTTP ${httpStatus}.`,
    hint: "Try again. If it keeps happening, reload the page.",
    code: `http-${httpStatus}`,
  };
}

/** `Retry-After` is seconds or an HTTP date; only the seconds form is used. */
export function formatRetryHint(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0
    ? `Try again in about ${Math.ceil(seconds)} seconds. What you typed is still here.`
    : "Wait a moment and try again. What you typed is still here.";
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB"] as const;

/**
 * Binary units, and they are LABELLED binary, because that is what the figure
 * is: `clone.ts` reads git's own `KiB`/`MiB` output and multiplies by 1024.
 * Printing "18.4 MB" over a 1024-based number would be a small, permanent lie.
 */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

/** `1.9s` / `340ms`, matching the wireframe's duration column. */
export function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${Math.round(durationMs / 100) / 10}s`;
}

/**
 * The one-line summary under the stage row: what is happening now, in words.
 *
 * It names a stage and, when git supplied one, a REAL byte total. There is no
 * fraction, no ETA and no bar, because the server does not know the size of
 * what it is fetching either — `receivedBytes` is a running total, not a
 * position in a known whole.
 */
export function summarizeScanRun(run: ScanRun): string {
  switch (run.phase) {
    case "idle":
      return "Not started.";
    case "cancelled":
      return "Scan cancelled. Nothing was kept on the server.";
    case "blocked":
      return run.failure?.title ?? "The scan stopped.";
    case "complete":
      return "Scan finished. The result is below.";
    case "streaming": {
      const running = run.stages.find((entry) => entry.phase === "running");
      if (running === undefined) return "Starting…";
      const received = formatBytes(running.receivedBytes);
      return received === null
        ? `${running.label} in progress…`
        : `${running.label} in progress — ${received} received.`;
    }
  }
}

/** Every log line the run has collected, oldest first, stage order. */
export function collectLogLines(run: ScanRun): readonly string[] {
  return run.stages.flatMap((entry) => entry.lines);
}
