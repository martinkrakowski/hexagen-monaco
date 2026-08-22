"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@hexagen/ui";
import { StageProgressList } from "@/StageProgressList";
import { ScanResultPanel } from "@/conformance/ScanResultPanel";
import { EmptyState } from "@/primitives/EmptyState";
import type { ProjectScanResponse } from "@/lib/project-scan/types";
import {
  formatBytes,
  formatDuration,
  MAX_STAGE_LOG_LINES,
  type ScanFailureCopy,
  type ScanStageProgress,
} from "./scan-stream";

/**
 * S2 — streaming scan progress (F-16, BF-5.3). PRESENTATIONAL ONLY.
 *
 * Every string it renders was computed by `scan-stream.ts` and handed in;
 * it decides nothing about the run. The only state it owns is whether the log
 * panel is open, which is interaction state (the user's own choice about this
 * screen), not information state.
 *
 * ## Composed, not rebuilt
 *
 * `StageProgressList` (BF-1.3) is the stage row, used exactly as `ThinkingBlock`
 * uses it: the dots and durations are the component's, and the CURRENT stage is
 * named separately below the row, because the component deliberately renders
 * `label` only as its accessible name. `ScanResultPanel`
 * (`components/conformance/`) is the finished-scan panel — the same one the
 * Tier-C zip flow uses, so the two tiers cannot drift — and `EmptyState`
 * (BF-2.3) is the blocked surface.
 *
 * The verbose log panel below is NOT `ThinkingBlock`'s. That one lives in
 * `features/manifest-generation`, which this slice cannot import (cross-slice
 * imports are CI-fatal), and BF-1.3's extraction note says in terms that the
 * log panel stayed behind because its per-line parsing, colouring and
 * auto-scroll are a separate concern. What is here is a plain, bounded
 * transcript of git's own output — no parsing, no severity colouring, no
 * interpretation.
 *
 * ## No synthetic percentages
 *
 * There is no progress bar in this file, and there is no percentage. A clone's
 * total size is not known in advance — not by the browser, and not by the
 * server, which is why `receivedBytes` is a running total that git may not
 * print at all. When a real figure exists it is shown as a figure; when one
 * does not, the row shows the stage name and nothing else. A bar filled from
 * elapsed time would be an invention, and inventing the one number the user is
 * actually watching is worse than showing no number.
 *
 * ## No auto-navigation
 *
 * This screen ends on a result. It never routes away from it — the standing
 * house rule for any flow that finishes on a log or telemetry surface. The
 * footer's buttons are the only way off.
 */

export interface ScanProgressViewProps {
  /** `owner/repo @ ref`, echoed by the server, or `null` before it speaks. */
  readonly repoLabel: string | null;
  readonly stages: readonly ScanStageProgress[];
  /** One-line summary of where the run is. Finished copy. */
  readonly summary: string;
  /** True while frames may still arrive — drives the live region's politeness. */
  readonly streaming: boolean;
  readonly logLines: readonly string[];
  /** True once the per-stage cap dropped older lines. */
  readonly logClipped: boolean;
  /** Server-issued correlation id (F-36), shown so it can be quoted. */
  readonly runId: string | null;
  /** Finished failure copy, or `null`. Mutually exclusive with `outcome`. */
  readonly failure: ScanFailureCopy | null;
  /** The `done` payload, or `null`. Mutually exclusive with `failure`. */
  readonly outcome: ProjectScanResponse | null;
  /** Footer note shown under a finished result. */
  readonly resultNote?: string;
}

/** `ScanStageProgress.phase` -> the vocabulary `StageProgressList` speaks. */
const PHASE_TO_INDICATOR: Readonly<
  Record<ScanStageProgress["phase"], "complete" | "active" | "pending">
> = {
  done: "complete",
  running: "active",
  waiting: "pending",
};

export function ScanProgressView({
  repoLabel,
  stages,
  summary,
  streaming,
  logLines,
  logClipped,
  runId,
  failure,
  outcome,
  resultNote,
}: ScanProgressViewProps) {
  const [logOpen, setLogOpen] = useState(true);
  const logId = useId();
  const logRef = useRef<HTMLPreElement | null>(null);

  // Follow the tail. Without this the panel shows the first screenful of a
  // clone forever, which is the least interesting part of it.
  useEffect(() => {
    const element = logRef.current;
    if (element === null || !logOpen) return;
    element.scrollTop = element.scrollHeight;
  }, [logLines.length, logOpen]);

  return (
    // `aria-busy` is the whole use of `streaming`: the visual cue is
    // StageProgressList's pulsing dot, and assistive technology needs the same
    // fact expressed in markup rather than in an animation.
    <div className="space-y-6" aria-busy={streaming}>
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">
          {repoLabel === null ? "Scanning" : `Scanning ${repoLabel}`}
        </h2>
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {summary}
        </p>
      </header>

      <StageProgressList
        className="self-center"
        stages={stages.map((stage) => ({
          id: String(stage.stage),
          label: stage.label,
          status: PHASE_TO_INDICATOR[stage.phase],
          duration:
            stage.phase === "done"
              ? (formatDuration(stage.durationMs) ?? undefined)
              : undefined,
        }))}
      />

      <ul className="space-y-1 text-sm">
        {stages.map((stage) => {
          const received = formatBytes(stage.receivedBytes);
          const duration = formatDuration(stage.durationMs);
          return (
            <li
              key={stage.stage}
              className="flex items-baseline justify-between gap-4"
            >
              <span
                className={
                  stage.phase === "waiting"
                    ? "text-muted-foreground"
                    : "font-medium"
                }
              >
                {stage.label}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {/*
                  Real figures or nothing. `received` is git's own byte total
                  and is absent whenever git printed none; `duration` is
                  measured by the server. Neither is ever estimated, and there
                  is deliberately no third value derived from the other two.
                */}
                {[received, stage.phase === "done" ? duration : null]
                  .filter((part): part is string => part !== null)
                  .join(" · ")}
              </span>
            </li>
          );
        })}
      </ul>

      {logLines.length === 0 ? null : (
        <section className="rounded-md border border-border">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Log
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={logOpen}
              aria-controls={logId}
              onClick={() => setLogOpen((open) => !open)}
            >
              {logOpen ? "Hide" : "Show"}
            </Button>
          </div>
          {logOpen ? (
            <pre
              id={logId}
              ref={logRef}
              className="max-h-48 overflow-auto px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words"
            >
              {logLines.join("\n")}
            </pre>
          ) : null}
          {logClipped ? (
            <p className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
              {`Only the most recent ${MAX_STAGE_LOG_LINES} lines per stage are kept.`}
            </p>
          ) : null}
        </section>
      )}

      {runId === null ? null : (
        <p className="text-xs text-muted-foreground">
          Run id <span className="font-mono">{runId}</span> — quote this if you
          report a problem.
        </p>
      )}

      {failure === null ? null : (
        <EmptyState
          icon={AlertTriangle}
          headingLevel={3}
          title={failure.title}
          description={
            <span className="space-y-2 block">
              <span className="block whitespace-pre-wrap">
                {failure.detail}
              </span>
              <span className="block">{failure.hint}</span>
            </span>
          }
        />
      )}

      {outcome === null ? null : (
        <div className="space-y-3">
          <ScanResultPanel
            verdict={outcome.verdict}
            exitCode={outcome.exitCode}
            layoutExcerpt={outcome.layoutExcerpt}
            filesScanned={outcome.filesScanned}
            reportMarkdown={outcome.reportMarkdown}
            errorMessage={outcome.errorMessage}
          />
          {resultNote === undefined ? null : (
            <p className="text-sm text-muted-foreground">{resultNote}</p>
          )}
        </div>
      )}
    </div>
  );
}
