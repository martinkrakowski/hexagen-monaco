"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, PlugZap } from "lucide-react";
import { Button, Spinner } from "@hexagen/ui";
import { ProjectsShellWithFreeTier } from "@/ProjectsShellWithFreeTier";
import { EmptyState } from "@/primitives/EmptyState";
import { MAX_PROJECT_NAME_CHARS } from "@/lib/project-scan/limits";
import {
  deriveStateFromEvent,
  type BrownfieldBlockReason,
  type BrownfieldFlowEvent,
  type BrownfieldFlowState,
  type BrownfieldFlowViewState,
} from "../BrownfieldFlow/types";
import { RepoEntryView } from "../RepoEntry/RepoEntryView";
import {
  describeSubmitBlocker,
  readRepoInput,
  suggestProjectName,
  toRepoReference,
} from "../RepoEntry/repo-input";
import { ScanProgressView } from "./ScanProgressView";
import {
  collectLogLines,
  describeUnavailable,
  summarizeScanRun,
} from "./scan-stream";
import { useGithubScan } from "./useGithubScan";

/**
 * S2 boundary component — Tier B, "scan a public GitHub repository"
 * (F-16, packet BF-5.3).
 *
 * The only file in the packet that talks to the router, the network (through
 * `useGithubScan`) or the state machine. `RepoEntryView` and `ScanProgressView`
 * are pure; `repo-input.ts` and `scan-stream.ts` are pure; this composes them.
 * Same split as `BrownfieldImportPage` (S1) and the S3/S4/S5 screens.
 *
 * ## Arriving here IS the tier choice
 *
 * `/projects/new/import/github` is a first-class entry point, so the flow
 * starts at `repo_entry` with `tier: "clone"` rather than at `tier_pick`. That
 * is exactly the state `SELECT_TIER { tier: "clone" }` produces, so the
 * machine's vocabulary is unchanged; the screen simply enters the flow one
 * state in.
 *
 * ## Where this screen stops, and why
 *
 * `SCAN_COMPLETE` is deliberately NOT dispatched. Its edge is
 * `scanning -> layout_ratify`, and the layout ratification screen belongs to
 * BF-4.1/F-17 and is not wired into this route. Dispatching it would leave the
 * user on a state this page cannot render — a blank screen instead of the
 * report they waited for. So the finished result is rendered IN PLACE, exactly
 * as BF-3.3 does for the Tier-A ingest, and the footer offers explicit choices.
 *
 * That is also the standing house rule for a flow that ends on a log or
 * telemetry surface: **the success arm performs no navigation.** The user reads
 * the result and leaves by pressing something.
 *
 * ## Cancelling is not failing
 *
 * `scanning` has exactly two outgoing edges (`layout_ratify` and `blocked`), so
 * a cancel cannot walk backwards in one step — and calling a user's own choice
 * "blocked" would be a lie in the copy. It is therefore folded through three
 * LEGAL edges (`SCAN_BLOCKED -> TRY_ANOTHER_TIER -> SELECT_TIER`), which is the
 * machine's own definition of starting a new run, and the block reason is
 * cleared on the way past so nothing stale survives.
 */

/** Copy shown under a finished result, marking the seam BF-4.1 plugs into. */
const NEXT_STEP_NOTE =
  "Ratifying the layout and the manifest arrives in the next release. The clone has already been deleted from the server; only the artifacts above were kept, and only for this page.";

/**
 * Failure code -> the machine's block-reason vocabulary.
 *
 * Keyed by `ScanFailureCopy.code`, which is the route's own wire code where
 * there was one and a `http-*`/`stream-*` marker where the failure happened
 * before or outside the protocol. Anything unlisted is `could-not-run`, which
 * is the honest default: the run did not produce artifacts and we are not
 * going to guess why.
 */
const BLOCK_REASON_FOR: Readonly<Record<string, BrownfieldBlockReason>> = {
  clone_failed: "repo-unreachable",
  repo_too_large: "repo-too-large",
};

function blockReasonFor(code: string | undefined): BrownfieldBlockReason {
  if (code === undefined) return "could-not-run";
  return BLOCK_REASON_FOR[code] ?? "could-not-run";
}

interface FormNotice {
  readonly text: string;
  /** True for a response to a failed action, false for an FYI. */
  readonly assertive: boolean;
}

/** The state a fresh entry into this route produces. */
function freshView(): BrownfieldFlowViewState {
  return { state: "repo_entry", tier: "clone" };
}

export function GithubScanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const formId = useId();

  // Carried in from the shared name step when the user came through it. This
  // screen does not REQUIRE it -- unlike Tier A it has its own name field, so
  // a direct link to /projects/new/import/github is a complete entry point
  // rather than a redirect back to a step the user did not ask for.
  const carriedName = searchParams.get("name")?.trim() ?? "";

  const [view, setView] = useState<BrownfieldFlowViewState>(freshView);
  const [repoInput, setRepoInput] = useState("");
  const [refInput, setRefInput] = useState("");
  const [projectName, setProjectName] = useState(
    carriedName.slice(0, MAX_PROJECT_NAME_CHARS),
  );
  const [nameTouched, setNameTouched] = useState(carriedName.length > 0);
  const [notice, setNotice] = useState<FormNotice | null>(null);

  const { availability, run, start, cancel, reset } = useGithubScan();

  /** Fold a sequence of events through the machine, left to right. */
  const foldEvents = useCallback(
    (from: BrownfieldFlowState, events: BrownfieldFlowEvent[]) =>
      events.reduce(deriveStateFromEvent, from),
    [],
  );

  const repoReading = useMemo(() => readRepoInput(repoInput), [repoInput]);

  const handleRepoInputChange = useCallback(
    (value: string) => {
      setRepoInput(value);
      setNotice(null);
      // Prefill the project name from the repository name, but only while the
      // user has not typed one themselves. They always see the result and can
      // always overwrite it -- it is a suggestion, never a decision.
      if (!nameTouched) setProjectName(suggestProjectName(value));
    },
    [nameTouched],
  );

  const handleProjectNameChange = useCallback((value: string) => {
    setNameTouched(true);
    setProjectName(value);
    setNotice(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    // The submit button is deliberately NOT disabled on an incomplete form: a
    // disabled control hides the reason it is disabled, and "why can I not
    // press this" is the single most common complaint about forms of this
    // shape. Pressing it always answers the question.
    const blocker = describeSubmitBlocker(repoInput, projectName);
    if (blocker !== null) {
      setNotice({ text: blocker, assertive: true });
      return;
    }
    const reference = toRepoReference(repoInput);
    if (reference === null) {
      setNotice({
        text: "That repository could not be read. Use `owner/repo`, or a full github.com URL.",
        assertive: true,
      });
      return;
    }

    setNotice(null);
    const scanning: BrownfieldFlowViewState = {
      ...view,
      state: deriveStateFromEvent(view.state, {
        type: "SUBMIT_REPO_REF",
        repoUrl: reference,
        ref: refInput.trim(),
      }),
      repoUrl: reference,
      repoRef: refInput.trim() || null,
      projectName: projectName.trim(),
      blockReason: null,
      error: null,
    };
    setView(scanning);

    const settled = await start({
      projectName,
      repoReference: reference,
      ref: refInput,
    });

    if (settled.phase === "cancelled") {
      setView({
        ...scanning,
        state: foldEvents(scanning.state, [
          { type: "SCAN_BLOCKED", reason: "could-not-run" },
          { type: "TRY_ANOTHER_TIER" },
          { type: "SELECT_TIER", tier: "clone" },
        ]),
        blockReason: null,
        error: null,
      });
      setNotice({
        text: "Scan cancelled. The server was told to stop and delete the clone; nothing was kept.",
        assertive: false,
      });
      return;
    }

    if (settled.phase === "blocked") {
      const reason = blockReasonFor(settled.failure?.code);
      setView({
        ...scanning,
        state: deriveStateFromEvent(scanning.state, {
          type: "SCAN_BLOCKED",
          reason,
        }),
        blockReason: reason,
        error: settled.failure?.detail ?? null,
      });
      return;
    }

    // Complete. No transition, no navigation -- see the docblock.
  }, [repoInput, projectName, refInput, view, start, foldEvents]);

  /**
   * "Scan a different repository" — two situations, one button.
   *
   * From `blocked` the machine has a real path back: `TRY_ANOTHER_TIER` walks
   * to `tier_pick` and `SELECT_TIER` re-enters at `repo_entry`. That is the
   * machine's own definition of starting a new run, so it is used.
   *
   * From a COMPLETED scan there is deliberately no backward edge at all —
   * `scanning` leads only to `layout_ratify` or `blocked`, because a scan is a
   * point-in-time artifact and the machine refuses to re-run one in place. So
   * this is not a transition there; it is a fresh entry into the flow, exactly
   * what mounting this route produces. Doing it by RESETTING rather than by
   * forcing an illegal edge leaves the machine's guarantee intact — and the
   * fold is attempted first, so the `blocked` path keeps its context.
   *
   * The typed repository, branch and project name are deliberately kept in
   * both cases: "a different repository" almost always means editing this one.
   */
  const startAnother = useCallback(() => {
    setView((current) => {
      const walked = foldEvents(current.state, [
        { type: "TRY_ANOTHER_TIER" },
        { type: "SELECT_TIER", tier: "clone" },
      ]);
      return walked === "repo_entry"
        ? { ...current, state: walked, blockReason: null, error: null }
        : freshView();
    });
    reset();
    setNotice(null);
  }, [foldEvents, reset]);

  const toImportOptions = useCallback(() => {
    router.push("/projects/new/import");
  }, [router]);

  const streaming = run.phase === "streaming";
  const onProgressScreen =
    view.state === "scanning" || view.state === "blocked";

  const footer = (() => {
    if (availability === "not-enabled") {
      return (
        <Button onClick={toImportOptions}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to import options
        </Button>
      );
    }

    if (onProgressScreen) {
      if (streaming) {
        return (
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
        );
      }
      return (
        <>
          <Button variant="outline" onClick={startAnother}>
            Scan a different repository
          </Button>
          <Button onClick={toImportOptions}>
            {run.phase === "complete"
              ? "Back to import options"
              : "Try another way"}
          </Button>
        </>
      );
    }

    return (
      <>
        <Button variant="outline" onClick={toImportOptions}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button
          type="submit"
          form={formId}
          disabled={availability === "checking" || streaming}
        >
          {streaming ? (
            <>
              <Spinner className="h-4 w-4 mr-2" />
              Scanning
            </>
          ) : (
            "Start scan"
          )}
        </Button>
      </>
    );
  })();

  const unavailable = describeUnavailable();

  return (
    <ProjectsShellWithFreeTier
      title="Import an existing codebase"
      footer={footer}
    >
      <div className="h-full overflow-y-auto">
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 w-full">
            {availability === "not-enabled" ? (
              // The kill switch is OFF by default, so this is the state most
              // deployments are in. It says so plainly: "not available" is the
              // truth, and "something went wrong" would not be.
              <EmptyState
                icon={PlugZap}
                headingLevel={2}
                title={unavailable.title}
                description={
                  <span className="space-y-2 block">
                    <span className="block">{unavailable.detail}</span>
                    <span className="block">{unavailable.hint}</span>
                  </span>
                }
              />
            ) : onProgressScreen ? (
              <ScanProgressView
                repoLabel={run.repoLabel ?? view.repoUrl ?? null}
                stages={run.stages}
                summary={summarizeScanRun(run)}
                streaming={streaming}
                logLines={collectLogLines(run)}
                logClipped={run.stages.some((stage) => stage.clipped)}
                runId={run.runId}
                failure={run.failure}
                outcome={run.outcome}
                resultNote={NEXT_STEP_NOTE}
              />
            ) : (
              <>
                {notice === null ? null : (
                  <p
                    role={notice.assertive ? "alert" : "status"}
                    className={
                      notice.assertive
                        ? "mb-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                        : "mb-6 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
                    }
                  >
                    {notice.text}
                  </p>
                )}
                <RepoEntryView
                  formId={formId}
                  repoInput={repoInput}
                  refInput={refInput}
                  projectName={projectName}
                  advisory={repoReading.advisory}
                  frozen={streaming}
                  onRepoInputChange={handleRepoInputChange}
                  onRefInputChange={(value) => {
                    setRefInput(value);
                    setNotice(null);
                  }}
                  onProjectNameChange={handleProjectNameChange}
                  onSubmit={() => {
                    void handleSubmit();
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </ProjectsShellWithFreeTier>
  );
}
