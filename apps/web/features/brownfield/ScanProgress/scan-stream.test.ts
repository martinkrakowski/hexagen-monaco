import { describe, it, expect } from "vitest";

import {
  applyScanFrame,
  collectLogLines,
  describePreStreamFailure,
  describeScanFailure,
  describeUnavailable,
  finishScanRun,
  formatBytes,
  formatDuration,
  initialScanRun,
  isProjectScanResponse,
  isRunSettled,
  isScanErrorCode,
  MAX_STAGE_LOG_LINES,
  parseScanFrame,
  SCAN_ERROR_CODES,
  startedScanRun,
  STAGE_CLONE,
  STAGE_SCAN,
  summarizeScanRun,
  type ScanFrame,
  type ScanRun,
} from "./scan-stream";

/**
 * The protocol half of S2 (BF-5.3).
 *
 * Written against `app/api/projects/scan/github/route.ts` frame by frame, not
 * against a mental model of it: every literal below is a shape that route can
 * actually emit. The four properties that matter most — no invented
 * percentages, a terminal failure staying terminal, a stream that dies without
 * a terminal frame being REPORTED rather than left spinning, and an unknown
 * code producing honest generic copy — each get their own test.
 */

const RUN_ID = "4f1b2c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function doneResult(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "violations",
    exitCode: 1,
    projectName: "checkout-service",
    layoutExcerpt: "contexts:\n  orders: {}",
    filesScanned: 2481,
    reportMarkdown: "# report",
    errorMessage: null,
    ...overrides,
  };
}

function line(frame: Record<string, unknown>): string {
  return JSON.stringify({ ...frame, runId: RUN_ID });
}

/** Fold a list of raw NDJSON lines the way the hook's read loop does. */
function foldLines(lines: string[], from: ScanRun = startedScanRun()): ScanRun {
  return lines.reduce((run, raw) => {
    const frame = parseScanFrame(raw);
    return frame === null ? run : applyScanFrame(run, frame);
  }, from);
}

function failureFrame(
  overrides: Partial<Extract<ScanFrame, { kind: "failure" }>> = {},
): Extract<ScanFrame, { kind: "failure" }> {
  return {
    kind: "failure",
    code: "clone_failed",
    rawCode: "clone_failed",
    message: "The repository could not be cloned.",
    reason: "clone",
    runId: RUN_ID,
    ...overrides,
  };
}

describe("parseScanFrame", () => {
  it("reads every frame type the route emits", () => {
    expect(
      parseScanFrame(
        line({
          type: "stage-start",
          stage: 0,
          label: "Clone",
          repo: "acme/checkout-service",
          ref: "main",
        }),
      ),
    ).toEqual({
      kind: "stage-start",
      stage: 0,
      label: "Clone",
      repo: "acme/checkout-service",
      ref: "main",
      runId: RUN_ID,
    });

    expect(
      parseScanFrame(
        line({
          type: "chunk",
          stage: 0,
          data: "Receiving objects:  62% (1540/2481), 8.10 MiB",
          receivedBytes: 8493465,
        }),
      ),
    ).toMatchObject({
      kind: "chunk",
      line: expect.any(String),
      receivedBytes: 8493465,
    });

    expect(
      parseScanFrame(
        line({ type: "stage-complete", stage: 0, durationMs: 1900 }),
      ),
    ).toMatchObject({ kind: "stage-complete", stage: 0, durationMs: 1900 });

    expect(
      parseScanFrame(line({ type: "done", result: doneResult() })),
    ).toMatchObject({ kind: "done" });

    expect(
      parseScanFrame(
        line({
          type: "error",
          code: "repo_too_large",
          message: "That repository is too large to scan here.",
          reason: "preflight",
        }),
      ),
    ).toMatchObject({
      kind: "failure",
      code: "repo_too_large",
      reason: "preflight",
    });
  });

  it("ignores blank lines, non-JSON and unknown frame types", () => {
    expect(parseScanFrame("")).toBeNull();
    expect(parseScanFrame("   ")).toBeNull();
    expect(parseScanFrame("not json")).toBeNull();
    expect(parseScanFrame("[1,2,3]")).toBeNull();
    expect(parseScanFrame(line({ type: "heartbeat" }))).toBeNull();
    expect(parseScanFrame(line({ type: "chunk", stage: 0 }))).toBeNull();
    expect(parseScanFrame(line({ type: "stage-start" }))).toBeNull();
  });

  it("keeps an unrecognised error code as `unknown` WITHOUT losing it", () => {
    const frame = parseScanFrame(
      line({ type: "error", code: "teapot", message: "?" }),
    );
    expect(frame).toMatchObject({
      kind: "failure",
      code: "unknown",
      rawCode: "teapot",
    });
  });

  it("turns a malformed `done` payload into a failure, never a success", () => {
    // A 200 with an unexpected shape must become a message, not a TypeError
    // during render — and emphatically not a silently ignored line, which
    // would leave the screen streaming against a stream that has ended.
    for (const broken of [
      undefined,
      null,
      "yaml",
      doneResult({ verdict: "probably-fine" }),
      doneResult({ filesScanned: "2481" }),
    ]) {
      const frame = parseScanFrame(line({ type: "done", result: broken }));
      expect(frame).toMatchObject({
        kind: "failure",
        rawCode: "malformed-done",
      });
    }
  });

  it("omits receivedBytes when the route omitted it, and never substitutes 0", () => {
    const frame = parseScanFrame(
      line({
        type: "chunk",
        stage: 0,
        data: "Resolving deltas: 100% (900/900)",
      }),
    );
    expect(frame).toMatchObject({ receivedBytes: null });
  });
});

describe("isScanErrorCode / isProjectScanResponse", () => {
  it("accepts exactly the route's closed set", () => {
    for (const code of SCAN_ERROR_CODES)
      expect(isScanErrorCode(code)).toBe(true);
    expect(isScanErrorCode("clone-failed")).toBe(false);
    expect(isScanErrorCode(undefined)).toBe(false);
  });

  it("checks every field the result panel dereferences", () => {
    expect(isProjectScanResponse(doneResult())).toBe(true);
    expect(isProjectScanResponse(doneResult({ exitCode: null }))).toBe(true);
    expect(isProjectScanResponse(doneResult({ projectName: 7 }))).toBe(false);
    expect(isProjectScanResponse({ verdict: "pass" })).toBe(false);
  });
});

describe("applyScanFrame", () => {
  it("seeds the two stages the route actually emits, not the wireframe's four", () => {
    const run = initialScanRun();
    expect(run.stages.map((stage) => stage.label)).toEqual(["Clone", "Scan"]);
    expect(run.stages.every((stage) => stage.phase === "waiting")).toBe(true);
  });

  it("walks clone -> scan -> done and carries the runId and repo label", () => {
    const run = foldLines([
      line({
        type: "stage-start",
        stage: 0,
        label: "Clone",
        repo: "acme/checkout",
        ref: "main",
      }),
      line({
        type: "chunk",
        stage: 0,
        data: "remote: Enumerating objects: 2481, done.",
      }),
      line({ type: "stage-complete", stage: 0, durationMs: 1900 }),
      line({ type: "stage-start", stage: 1, label: "Scan" }),
      line({ type: "stage-complete", stage: 1, durationMs: 8200 }),
      line({ type: "done", result: doneResult() }),
    ]);

    expect(run.phase).toBe("complete");
    expect(run.runId).toBe(RUN_ID);
    expect(run.repoLabel).toBe("acme/checkout @ main");
    expect(run.outcome?.filesScanned).toBe(2481);
    expect(run.stages.map((stage) => stage.phase)).toEqual(["done", "done"]);
    expect(formatDuration(run.stages[STAGE_CLONE].durationMs)).toBe("1.9s");
  });

  it("keeps the LAST REAL byte figure and never fabricates one in between", () => {
    const run = foldLines([
      line({ type: "stage-start", stage: 0, label: "Clone" }),
      line({
        type: "chunk",
        stage: 0,
        data: "Receiving objects: 10%, 2.00 MiB",
        receivedBytes: 2097152,
      }),
      // git printed no figure on this line. The previous REAL total stands; it
      // is not blanked, and it is not advanced by a guess.
      line({
        type: "chunk",
        stage: 0,
        data: "Resolving deltas: 100% (900/900)",
      }),
    ]);
    expect(run.stages[STAGE_CLONE].receivedBytes).toBe(2097152);

    const noFigureEver = foldLines([
      line({ type: "stage-start", stage: 0, label: "Clone" }),
      line({ type: "chunk", stage: 0, data: "Cloning…" }),
    ]);
    expect(noFigureEver.stages[STAGE_CLONE].receivedBytes).toBeNull();
    // The summary line for a stage with no figure names the stage and stops.
    expect(summarizeScanRun(noFigureEver)).toBe("Clone in progress…");
    expect(summarizeScanRun(noFigureEver)).not.toMatch(/%/);
  });

  it("treats an error frame as TERMINAL — later frames cannot resurrect a result", () => {
    const run = foldLines([
      line({ type: "stage-start", stage: 0, label: "Clone" }),
      line({ type: "chunk", stage: 0, data: "Cloning…" }),
      line({
        type: "error",
        code: "clone_failed",
        message: "The repository could not be cloned.",
        reason: "clone",
      }),
      // A proxy replaying a buffer, or a server that keeps talking. None of it
      // lands: "blocked, no artifacts" is the plan's rule for a failed clone.
      line({ type: "stage-complete", stage: 0, durationMs: 1900 }),
      line({ type: "stage-start", stage: 1, label: "Scan" }),
      line({ type: "done", result: doneResult() }),
    ]);

    expect(run.phase).toBe("blocked");
    expect(run.outcome).toBeNull();
    expect(run.failure?.title).toBe("That repository could not be cloned");
    expect(isRunSettled(run)).toBe(true);
  });

  it("appends a stage index the protocol did not seed rather than dropping it", () => {
    const run = foldLines([
      line({ type: "stage-start", stage: 2, label: "Report" }),
      line({ type: "chunk", stage: 2, data: "writing report" }),
    ]);
    expect(run.stages.map((stage) => stage.stage)).toEqual([0, 1, 2]);
    expect(run.stages[2].label).toBe("Report");
    expect(run.stages[2].lines).toEqual(["writing report"]);
  });

  it("bounds the per-stage log and says so", () => {
    const lines = Array.from(
      { length: MAX_STAGE_LOG_LINES + 25 },
      (_unused, index) =>
        line({ type: "chunk", stage: 0, data: `line ${index}` }),
    );
    const run = foldLines([
      line({ type: "stage-start", stage: 0, label: "Clone" }),
      ...lines,
    ]);
    expect(run.stages[STAGE_CLONE].lines).toHaveLength(MAX_STAGE_LOG_LINES);
    expect(run.stages[STAGE_CLONE].clipped).toBe(true);
    expect(run.stages[STAGE_CLONE].lines.at(-1)).toBe(
      `line ${MAX_STAGE_LOG_LINES + 24}`,
    );
    expect(collectLogLines(run)).toHaveLength(MAX_STAGE_LOG_LINES);
  });

  it("marks a still-running stage done when `done` arrives without its completion", () => {
    const run = foldLines([
      line({ type: "stage-start", stage: 1, label: "Scan" }),
      line({ type: "done", result: doneResult() }),
    ]);
    expect(run.stages[STAGE_SCAN].phase).toBe("done");
  });
});

describe("finishScanRun", () => {
  it("reports a stream that ended with no terminal frame instead of spinning", () => {
    const mid = foldLines([
      line({ type: "stage-start", stage: 0, label: "Clone" }),
      line({
        type: "chunk",
        stage: 0,
        data: "Receiving objects: 10%",
        receivedBytes: 1024,
      }),
    ]);
    expect(mid.phase).toBe("streaming");

    const ended = finishScanRun(mid, { kind: "eof" });
    expect(ended.phase).toBe("blocked");
    expect(ended.outcome).toBeNull();
    expect(ended.failure?.title).toBe("The scan stopped before it finished");
    // The quota really was charged before the clone started. Saying so is the
    // difference between an explanation and a shrug.
    expect(ended.failure?.hint).toMatch(/counted against today's scan limit/);
  });

  it("distinguishes a dead connection from a user cancel", () => {
    const mid = foldLines([
      line({ type: "stage-start", stage: 0, label: "Clone" }),
    ]);

    const cancelled = finishScanRun(mid, { kind: "cancelled" });
    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.failure).toBeNull();
    expect(summarizeScanRun(cancelled)).toMatch(/cancelled/i);

    const silent = finishScanRun(mid, { kind: "silent", afterMs: 180_000 });
    expect(silent.phase).toBe("blocked");
    expect(silent.failure?.detail).toMatch(/180 seconds/);

    const transport = finishScanRun(mid, {
      kind: "transport",
      detail: "Failed to fetch",
    });
    expect(transport.failure?.detail).toBe("Failed to fetch");
  });

  it("cannot overwrite a run that already settled", () => {
    const blocked = foldLines([
      line({
        type: "error",
        code: "timeout",
        message: "The scan exceeded its time budget and was stopped.",
      }),
    ]);
    expect(finishScanRun(blocked, { kind: "eof" })).toBe(blocked);
  });
});

describe("describeScanFailure", () => {
  it("prefers the route's own message as the detail", () => {
    // The quota gate's message names the real limit and the real reset time.
    // A paraphrase here would rot the first time that copy changes.
    const copy = describeScanFailure(
      failureFrame({
        code: "quota_exhausted",
        rawCode: "quota_exhausted",
        message:
          "You've reached the free-tier daily limit of 3 project scans. It resets at midnight UTC.",
        reason: null,
      }),
    );
    expect(copy.detail).toMatch(/daily limit of 3 project scans/);
    expect(copy.title).toBe("Today's scan limit has been reached");
    expect(copy.hint).toMatch(/hexagen CLI/);
  });

  it("keys the clone_failed hint off the machine-readable reason", () => {
    expect(
      describeScanFailure(failureFrame({ reason: "reference-not-github" }))
        .hint,
    ).toMatch(/github\.com/);
    expect(
      describeScanFailure(failureFrame({ reason: "preflight" })).hint,
    ).toMatch(/PUBLIC/);
    // An unrecognised reason falls back rather than rendering `undefined`.
    expect(
      describeScanFailure(failureFrame({ reason: "brand-new-token" })).hint,
    ).toBe(
      "Check the owner, repository and branch, and that the repository is public.",
    );
  });

  it("names the real scan budget on a scan-stage timeout and no number otherwise", () => {
    const onScan = describeScanFailure(
      failureFrame({
        code: "timeout",
        rawCode: "timeout",
        message: null,
        reason: "scan",
      }),
      STAGE_SCAN,
    );
    expect(onScan.detail).toBe(
      "The scan exceeded its 45-second budget and was stopped.",
    );

    // The clone budget lives in a module that cannot enter a client bundle, so
    // a clone-stage timeout must NOT invent a figure.
    const onClone = describeScanFailure(
      failureFrame({
        code: "timeout",
        rawCode: "timeout",
        message: "The scan exceeded its time budget and was stopped.",
        reason: "clone",
      }),
      STAGE_CLONE,
    );
    expect(onClone.detail).toBe(
      "The scan exceeded its time budget and was stopped.",
    );
    expect(onClone.detail).not.toMatch(/\d+-second/);
  });

  it("is honest and generic about a code it does not recognise", () => {
    const copy = describeScanFailure(
      failureFrame({
        code: "unknown",
        rawCode: "teapot",
        message: null,
        reason: null,
      }),
    );
    expect(copy.title).toBe("The scan stopped");
    expect(copy.detail).toMatch(/did not explain/);
    // It must not have guessed at one of the known failures.
    expect(copy.detail).not.toMatch(/clone|quota|too large/i);
    expect(copy.code).toBe("teapot");
  });

  it("covers every code in the closed set", () => {
    for (const code of SCAN_ERROR_CODES) {
      const copy = describeScanFailure(
        failureFrame({ code, rawCode: code, message: null, reason: null }),
      );
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
      expect(copy.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("describePreStreamFailure", () => {
  it("says a 404 is switched off, not broken", () => {
    const copy = describePreStreamFailure(404, null, null);
    expect(copy).toEqual(describeUnavailable());
    expect(copy.title).toMatch(/not available here/);
    expect(copy.detail).toMatch(/switched off, not broken/);
    expect(copy.detail).not.toMatch(/went wrong|error/i);
  });

  it("tells the daily quota 429 apart from the per-IP rate-limit 429", () => {
    // The quota denial is re-framed by the route into NDJSON WITH a code.
    const quota = describePreStreamFailure(
      429,
      failureFrame({
        code: "quota_exhausted",
        rawCode: "quota_exhausted",
        message: "You've reached the free-tier daily limit of 3 project scans.",
        reason: null,
      }),
      "3600",
    );
    expect(quota.title).toBe("Today's scan limit has been reached");

    // `guardMutation`'s 429 is plain JSON with no code — recognised by the
    // ABSENCE of a frame, and it is transient rather than terminal.
    const rateLimit = describePreStreamFailure(429, null, "20");
    expect(rateLimit.title).toBe("Too many scans in a short time");
    expect(rateLimit.hint).toMatch(/about 20 seconds/);
  });

  it("has distinct copy for 403, 5xx and anything else", () => {
    expect(describePreStreamFailure(403, null, null).title).toMatch(
      /not accepted/,
    );
    expect(describePreStreamFailure(500, null, null).title).toMatch(
      /before the scan started/,
    );
    expect(describePreStreamFailure(418, null, null).detail).toMatch(
      /HTTP 418/,
    );
  });
});

describe("formatting", () => {
  it("labels binary units binary, because that is what the figure is", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KiB");
    expect(formatBytes(19_293_798)).toBe("18.4 MiB");
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(Number.NaN)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
  });

  it("formats durations the way the wireframe's column does", () => {
    expect(formatDuration(340)).toBe("340ms");
    expect(formatDuration(1900)).toBe("1.9s");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-5)).toBeNull();
  });

  it("summarises each phase without ever quoting a fraction", () => {
    expect(summarizeScanRun(initialScanRun())).toBe("Not started.");
    const streaming = foldLines([
      line({ type: "stage-start", stage: 0, label: "Clone" }),
      line({
        type: "chunk",
        stage: 0,
        data: "Receiving objects",
        receivedBytes: 19_293_798,
      }),
    ]);
    expect(summarizeScanRun(streaming)).toBe(
      "Clone in progress — 18.4 MiB received.",
    );
    expect(summarizeScanRun(streaming)).not.toMatch(/%/);
  });
});
