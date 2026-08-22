"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Button, Spinner } from "@hexagen/ui";
import { ProjectsShellWithFreeTier } from "@/ProjectsShellWithFreeTier";
import { EmptyState } from "@/primitives/EmptyState";
import {
  MAX_PROJECT_NAME_CHARS,
  TIER_A_MAX_ZIP_ENTRIES,
} from "@/lib/project-scan/limits";
import type { ProjectHandoffResponse } from "@/lib/project-scan/artifact-parse";
import {
  deriveStateFromEvent,
  type BrownfieldBlockReason,
  type BrownfieldFlowEvent,
  type BrownfieldFlowViewState,
  type BrownfieldTier,
} from "./BrownfieldFlow/types";
import { useBrownfieldDraft } from "./draft/useBrownfieldDraft";
import { ArtifactUploadView } from "./views/ArtifactUploadView";
import type { ArtifactUploadAlert } from "./views/ArtifactUploadView";
import { TierPickerView } from "./views/TierPickerView";

/**
 * S1 boundary component for the brownfield adoption flow (F-15, BF-3.3).
 *
 * This is the only file in the packet that talks to the router, the network or
 * the state machine; `views/*` are pure. The split follows the repo's
 * container/presentational convention and is what makes the views testable
 * without a router mock, a fetch stub or the free-tier context.
 *
 * ## What this screen is for
 *
 * Tier A is the procurement story: the user ran `hexagen scan --handoff`
 * locally, so the manifest, layout and baseline already exist on their machine.
 * Nothing here executes anything — `POST /api/projects/scan/artifacts` parses
 * the uploaded text files in-process and returns them. The upload IS the whole
 * product surface for this tier, which is why every reachable HTTP status below
 * gets its own copy rather than a shared "something went wrong".
 *
 * ## Where the flow stops, and why it stops there
 *
 * The state machine (BF-3.1) runs `uploading -> scanning -> layout_ratify` and
 * on to a report. `scanning` is a Tier-B concept (there is no stream to watch
 * when the parse finished inside the POST), and the ratification screens are
 * BF-4.1/4.2/4.4. So this packet drives `tier_pick`, `uploading` and `blocked`
 * only, and the ingest result is rendered in place on the upload screen.
 *
 * The success arm deliberately performs NO navigation (see the house rule on
 * flows that end on a result screen, and the machine's own comment that
 * `report` is terminal-with-actions). The user reads the report they came for
 * and leaves by pressing something.
 */

/** The seam BF-6.2 (`GateInstall/`) plugs into: the footer of the result state. */
const NEXT_STEP_NOTE =
  "Ratifying the layout and installing the conformance gate arrive in the next release. Nothing you uploaded was stored.";

/** Field name for the single-zip form part the route looks for first. */
const ZIP_FIELD = "zip";
/** Field name for loose artifact parts. The route reads every non-`name` part. */
const LOOSE_FIELD = "files";

/**
 * Loose-file ceiling. The route's own `MAX_HANDOFF_LOOSE_FILES` is DEFINED as
 * `TIER_A_ZIP_UNPACK_LIMITS.maxEntries`, i.e. this constant — but it lives in
 * `artifact-parse.ts`, which imports `node:fs/promises` and therefore cannot be
 * pulled into a client bundle. Reading the same value from the client-safe
 * `limits.ts` keeps the two in lockstep instead of hard-coding an 8 that would
 * drift the moment the profile changes.
 */
const MAX_LOOSE_FILES = TIER_A_MAX_ZIP_ENTRIES;

function freshViewState(): BrownfieldFlowViewState {
  return { state: "tier_pick", tier: null };
}

/**
 * Whether a single selected file should be sent as the `zip` part.
 *
 * Deliberately NOT a mirror of `isZipFile()` in
 * app/api/projects/scan/artifacts/route.ts, and the difference matters.
 *
 * The server calls its predicate on a file ALREADY placed in the zip field —
 * it asks "is this really a zip?", so being permissive only accepts an odd
 * upload. This asks the opposite question: "should this go in the zip field?"
 * A false positive here MISROUTES a legitimate loose artifact into the zip
 * slot, where the server then fails to unzip it.
 *
 * So `application/octet-stream` is excluded even though the server allows it:
 * browsers routinely report it for files they cannot type, including the
 * .yaml and .md artifacts of a loose upload. Accepting it would mean selecting
 * a single manifest.yaml sends it as a zip — a regression on the common path
 * to fix a rare one. The unambiguous zip media types are honoured, so a
 * handoff zip saved without a .zip extension still routes correctly.
 */
export function looksLikeZip(file: File): boolean {
  if (file.name.toLowerCase().endsWith(".zip")) return true;
  const type = file.type.toLowerCase();
  return type === "application/zip" || type === "application/x-zip-compressed";
}

export function isHandoffResponse(value: unknown): value is ProjectHandoffResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record.source !== "handoff-artifacts" ||
    (record.verdict !== "ingested" && record.verdict !== "incomplete") ||
    !Array.isArray(record.warnings) ||
    // Every warning is rendered as a React child (`<li>{warning}</li>`), and
    // React THROWS on a non-primitive child ("Objects are not valid as a React
    // child"). So the element type is a crash surface, not a cosmetic detail.
    !record.warnings.every((warning) => typeof warning === "string")
  ) {
    return false;
  }
  // `artifacts` is not merely "an object". The render path reads
  // `artifacts.present.length` and `artifacts.missing.length`, so a payload
  // where those are absent passed this guard and then threw a TypeError --
  // which is exactly the "200 with an unexpected shape" case the guard exists
  // to turn into a message. A guard must check what its callers dereference,
  // not what is convenient to check.
  const artifacts = record.artifacts;
  if (typeof artifacts !== "object" || artifacts === null) return false;
  const shape = artifacts as Record<string, unknown>;
  return Array.isArray(shape.present) && Array.isArray(shape.missing);
}

/** Pull the route's own message out of a JSON error body, if there is one. */
function serverMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const message = (body as { error?: unknown }).error;
  return typeof message === "string" && message.trim().length > 0
    ? message.trim()
    : null;
}

/**
 * `Retry-After` off a 429, defensively. A `Response` always has `headers`, but
 * a test double or a polyfilled runtime may not, and a TypeError thrown while
 * COMPOSING an error message would replace a precise rate-limit alert with a
 * generic network one — the worst possible substitution.
 */
function retryAfterOf(response: Response): string | null {
  try {
    return response.headers.get("Retry-After");
  } catch {
    return null;
  }
}

interface UploadFailure {
  alert: ArtifactUploadAlert;
  /**
   * True when the RUN is over: the artifacts themselves cannot be used, so the
   * honest recovery is a different upload or a different tier. False for
   * transient faults (rate limit, origin check, server fault, network), where
   * the same files pressed again is a perfectly reasonable next action and
   * kicking the user back to the tier picker would be theatre.
   */
  blocks: boolean;
  reason: BrownfieldBlockReason;
}

/**
 * Every status `POST /api/projects/scan/artifacts` can return, mapped to copy
 * that tells the user what to do next. Read against the route and
 * `artifact-parse.ts`, not guessed:
 *
 *   400 - `guardMutation` passed but the upload is unusable: bad
 *         Content-Length, not multipart, missing/over-long name, not a .zip,
 *         zip over 2 MiB, too many loose parts, an over-large loose part, or a
 *         `rejected` ingest outcome (zip-slip, invalid-zip, zip-too-large,
 *         duplicate-zip-entry, empty-zip, no-artifacts).
 *   403 - same-origin check rejected the request (CSRF gate, decision D1).
 *   413 - the request body exceeded the cap, either by Content-Length or by
 *         the streaming byte counter that bounds a chunked upload.
 *   429 - the route's own rate-limit namespace (15/minute), with `Retry-After`.
 *   500 - a genuine server fault while staging or reading the upload.
 *   405 - GET only; unreachable from here, covered by the fallback.
 *
 * The server's own message is surfaced verbatim wherever it exists, because it
 * is more specific than anything written here (it names the actual byte limit,
 * the offending file, or the missing artifact) and because a paraphrase would
 * silently rot the first time the route's wording changes.
 */
function failureFor(
  status: number,
  body: unknown,
  retryAfter: string | null,
): UploadFailure {
  const message = serverMessage(body);

  if (status === 400) {
    return {
      blocks: true,
      reason: "upload-rejected",
      alert: {
        title: "That upload could not be used",
        detail: message ?? "The server rejected the upload.",
        // The route returns 400 for BOTH a malformed handoff and an oversized
        // one ("Handoff zip is too large…"), so a single hint was wrong for
        // one of them. 413 covers the whole request being too large; the
        // per-part zip cap lands here instead.
        hint: /too large|exceeds/i.test(message ?? "")
          ? "A handoff zip is a handful of small text files. If yours is large you probably zipped the repository — that is the \"Upload a zip\" tier, not this one."
          : "Re-run `npx hexagen scan --handoff` in your repository and upload the zip it writes, unchanged. Repacking or renaming its contents is the usual cause.",
      },
    };
  }

  if (status === 413) {
    return {
      blocks: true,
      reason: "upload-rejected",
      alert: {
        title: "That upload is too large",
        detail: message ?? "The upload exceeded this route's size limit.",
        hint: "A handoff bundle is a handful of small text files. If yours is large you have probably zipped the repository itself — that is the 'Upload a zip' tier, which accepts far bigger archives.",
      },
    };
  }

  if (status === 403) {
    return {
      blocks: false,
      reason: "upload-rejected",
      alert: {
        title: "The upload was not accepted from this page",
        detail:
          message ??
          "The request was rejected because it did not appear to come from this site.",
        hint: "Reload this page from the app's own address and try again. A tab left open through a sign-in or a redirect is the usual cause; nothing was uploaded.",
      },
    };
  }

  if (status === 429) {
    const seconds = Number(retryAfter);
    const wait =
      Number.isFinite(seconds) && seconds > 0
        ? `Try again in about ${Math.ceil(seconds)} seconds.`
        : "Wait a moment and try again.";
    return {
      blocks: false,
      reason: "upload-rejected",
      alert: {
        title: "Too many uploads in a short time",
        detail: message ?? "This route accepts a limited number of uploads.",
        hint: `${wait} Your files are still selected.`,
      },
    };
  }

  if (status >= 500) {
    return {
      blocks: false,
      reason: "could-not-run",
      alert: {
        title: "We could not parse those artifacts",
        detail: message ?? "The server failed while reading the upload.",
        hint: "Nothing was saved. Try again — and if it keeps failing, the artifacts may come from an older release, so re-run the scan with the current `hexagen` CLI.",
      },
    };
  }

  return {
    blocks: false,
    reason: "could-not-run",
    alert: {
      title: "The upload failed",
      detail: message ?? `The server responded with HTTP ${status}.`,
      hint: "Try again. If it keeps happening, reload the page.",
    },
  };
}

export function BrownfieldImportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const carriedName = searchParams.get("name")?.trim() || "";
  const nameTooLong = carriedName.length > MAX_PROJECT_NAME_CHARS;

  const [view, setView] = useState<BrownfieldFlowViewState>(freshViewState);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [alert, setAlert] = useState<ArtifactUploadAlert | null>(null);
  const [result, setResult] = useState<ProjectHandoffResponse | null>(null);

  const { restoredView, saveDraft, discardDraft } =
    useBrownfieldDraft(carriedName);
  const draftApplied = useRef(false);

  useEffect(() => {
    if (!carriedName) {
      router.replace("/projects/new/name?path=artifacts");
    }
  }, [carriedName, router]);

  /**
   * Apply the recovered draft exactly once, and only while the user has not
   * yet chosen anything themselves. `restoredView` is documented as flipping
   * from null to a value once after hydration, so a naive effect would race a
   * user who picked a tier during that window and silently overwrite them.
   *
   * For this packet the draft carries one useful field — the tier — because
   * `resolveResumeState` clamps `uploading` and `blocked` back to `tier_pick`
   * (a File cannot be persisted, and a previous run's failure is not user
   * input). That is exactly the intended behaviour, not a limitation to work
   * around.
   */
  useEffect(() => {
    if (draftApplied.current) return;
    if (restoredView === null) return;
    draftApplied.current = true;
    setView((current) =>
      current.state === "tier_pick" && (current.tier ?? null) === null
        ? { ...restoredView }
        : current,
    );
  }, [restoredView]);

  /**
   * Set-and-persist. Written against the `view` captured by this render rather
   * than through a functional updater on purpose: `saveDraft` is a side effect
   * (it writes to storage), and React may invoke a functional updater twice, so
   * putting the write inside one would make it fire twice under StrictMode.
   * Every caller is an event handler running after commit, so the captured
   * `view` is the committed one.
   */
  const applyView = useCallback(
    (next: BrownfieldFlowViewState) => {
      setView(next);
      saveDraft(next);
    },
    [saveDraft],
  );

  /**
   * Every screen change goes through the machine. A view that wants an illegal
   * edge gets its current state back rather than teleporting the user — that
   * is the property BF-3.1 encoded structurally, and reaching around it here
   * would give it away on the first screen that uses it.
   */
  const dispatch = useCallback(
    (
      event: BrownfieldFlowEvent,
      patch: Partial<BrownfieldFlowViewState> = {},
    ) => {
      applyView({
        ...view,
        ...patch,
        state: deriveStateFromEvent(view.state, event),
      });
    },
    [view, applyView],
  );

  const [resetToken, setResetToken] = useState(0);

  const resetUpload = useCallback(() => {
    setFiles([]);
    setResult(null);
    setAlert(null);
    setStatusMessage("");
    // Remounts the file input, dropping its internal FileList. Without this,
    // clearing React state left the real control still holding the previous
    // selection, so re-picking the SAME file fired no change event and the
    // user could not retry it.
    setResetToken((token) => token + 1);
  }, []);

  const handleFilesSelected = useCallback((next: File[]) => {
    setFiles(next);
    setResult(null);
    setAlert(null);
    setStatusMessage(
      next.length === 0
        ? ""
        : `${next.length} file${next.length === 1 ? "" : "s"} selected.`,
    );
  }, []);

  const handleUpload = useCallback(async () => {
    if (busy || files.length === 0 || !carriedName || nameTooLong) return;

    // Client-side checks the route cannot make cheaply, or that would cost a
    // whole round trip to learn. Both produce the same alert shape as a server
    // rejection so the screen has one error surface, not two.
    // Uses the SAME predicate as the routing decision below. When this
    // checked only the .zip suffix, a zip identified by media type slipped
    // past the guard and was then posted as a loose artifact -- precisely the
    // outcome this alert exists to prevent. One predicate, both places.
    const hasZip = files.some(looksLikeZip);
    if (files.length > 1 && hasZip) {
      setResult(null);
      setStatusMessage("");
      setAlert({
        title: "Select the handoff zip on its own",
        detail:
          "A zip mixed in with loose files is ignored — only the loose files would be read.",
        hint: "Upload just the zip, or just the individual artifact files.",
      });
      return;
    }
    if (files.length > MAX_LOOSE_FILES) {
      setResult(null);
      setStatusMessage("");
      setAlert({
        title: "Too many files",
        detail: `A handoff contains at most ${MAX_LOOSE_FILES} artifacts; ${files.length} were selected.`,
        hint: "Upload the handoff zip instead, or select only the artifact files.",
      });
      return;
    }

    setAlert(null);
    setResult(null);
    setBusy(true);
    setStatusMessage("Uploading artifacts…");

    try {
      const form = new FormData();
      form.append("name", carriedName);
      const single = files.length === 1 ? files[0] : null;
      if (single !== null && looksLikeZip(single)) {
        form.append(ZIP_FIELD, single, single.name);
      } else {
        for (const file of files) form.append(LOOSE_FIELD, file, file.name);
      }

      // "Parsing" is announced AFTER the request settles, not before it is
      // sent. Setting it here previously overwrote "Uploading artifacts…" in
      // the same tick, so the live region claimed parsing was underway for the
      // entire upload -- and on a slow connection that is the whole wait.
      const response = await fetch("/api/projects/scan/artifacts", {
        method: "POST",
        body: form,
      });
      setStatusMessage("Parsing the handoff artifacts…");
      // `.catch(() => null)` conflated two different failures: a malformed
      // body and a literal `null` body both arrived as null, so neither the
      // copy nor a future reader could tell them apart. app/lib/fetch-json.ts
      // exists precisely to stop that idiom swallowing parse errors, and its
      // docblock says so.
      let bodyParsed = true;
      const body: unknown = await response.json().catch(() => {
        bodyParsed = false;
        return null;
      });

      if (!response.ok) {
        const failure = failureFor(
          response.status,
          body,
          retryAfterOf(response),
        );
        setAlert(failure.alert);
        setStatusMessage(`${failure.alert.title}.`);
        if (failure.blocks) {
          dispatch(
            { type: "UPLOAD_FAILED", reason: failure.reason },
            {
              blockReason: failure.reason,
              error: failure.alert.detail,
              uploadedFileName: single?.name ?? null,
            },
          );
        }
        return;
      }

      if (!isHandoffResponse(body)) {
        setAlert({
          title: "The server returned an unexpected response",
          detail: bodyParsed
            ? "The upload succeeded but the reply did not look like a parsed handoff."
            : "The upload succeeded but the reply was not valid JSON, so it could not be read.",
          hint: "Try again. If it repeats, this build of the app and the API are out of step.",
        });
        setStatusMessage("The server returned an unexpected response.");
        return;
      }

      setResult(body);
      setStatusMessage(
        body.verdict === "ingested"
          ? `Artifacts ingested. ${body.artifacts.present.length} of the handoff files were read; the report is shown below.`
          : "The handoff was incomplete — no report was found in the upload.",
      );
      applyView({ ...view, uploadedFileName: single?.name ?? null });
    } catch (err) {
      // A thrown fetch never reached the server: no status, no body.
      setAlert({
        title: "Could not reach the server",
        detail:
          err instanceof Error
            ? err.message
            : "The upload request failed before it completed.",
        hint: "Nothing was uploaded. Check your connection and try again — your files are still selected.",
      });
      setStatusMessage("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [busy, files, carriedName, nameTooLong, dispatch, applyView, view]);

  const handleContinueFromTierPick = useCallback(() => {
    const tier = view.tier ?? null;
    if (tier === null) return;
    if (tier === "artifacts") {
      resetUpload();
      dispatch({ type: "SELECT_TIER", tier });
      return;
    }
    if (tier === "zip") {
      // Tier C already ships (#558). Handing the carried name to the existing
      // screen is the honest destination; re-implementing a zip upload here
      // would fork it.
      router.push(
        `/projects/new/import/scan?name=${encodeURIComponent(carriedName)}`,
      );
    }
    // "clone" is rendered disabled and cannot be the selected tier.
  }, [view.tier, dispatch, resetUpload, router, carriedName]);

  const startOver = useCallback(() => {
    resetUpload();
    dispatch({ type: "TRY_ANOTHER_TIER" });
  }, [resetUpload, dispatch]);

  if (!carriedName) return null;

  const footer = (() => {
    if (view.state === "blocked") {
      return (
        <>
          <Button
            variant="outline"
            onClick={() => {
              discardDraft();
              router.push("/projects/new/import");
            }}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Import options
          </Button>
          <Button onClick={startOver}>Try another way</Button>
        </>
      );
    }

    if (view.state === "uploading") {
      // The success arm never navigates. Once a report is on screen the footer
      // offers explicit choices and nothing else moves.
      if (result !== null) {
        return (
          <>
            <Button variant="outline" onClick={resetUpload} disabled={busy}>
              Upload different artifacts
            </Button>
            <Button onClick={() => router.push("/projects/new/import")}>
              Back to import options
            </Button>
          </>
        );
      }
      return (
        <>
          <Button
            variant="outline"
            onClick={() => {
              resetUpload();
              dispatch({ type: "GO_BACK" });
            }}
            disabled={busy}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={handleUpload}
            disabled={busy || files.length === 0 || nameTooLong}
          >
            {busy ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Uploading
              </>
            ) : (
              "Upload and parse"
            )}
          </Button>
        </>
      );
    }

    return (
      <>
        <Button
          variant="outline"
          onClick={() => router.push("/projects/new/import")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={handleContinueFromTierPick}
          disabled={
            // "clone" is checked as well as null: a draft written by a future
            // Tier-B run could restore a tier this build cannot act on, and an
            // enabled button that does nothing is worse than a disabled one.
            (view.tier ?? null) === null || view.tier === "clone" || nameTooLong
          }
        >
          Continue
        </Button>
      </>
    );
  })();

  return (
    <ProjectsShellWithFreeTier
      title="Import an existing codebase"
      footer={footer}
    >
      <div className="h-full overflow-y-auto">
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 w-full">
            <BrownfieldStepIndicator />

            {nameTooLong ? (
              <div
                role="alert"
                className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {`Project name exceeds ${MAX_PROJECT_NAME_CHARS} characters. Go back and shorten it before uploading.`}
              </div>
            ) : null}

            {view.state === "tier_pick" ? (
              <TierPickerView
                tier={view.tier ?? null}
                projectName={carriedName}
                onSelectTier={(tier: BrownfieldTier) =>
                  applyView({ ...view, tier })
                }
              />
            ) : null}

            {view.state === "uploading" ? (
              <>
                <ArtifactUploadView
          resetToken={resetToken}
                  projectName={carriedName}
                  selectedFiles={files}
                  onFilesSelected={handleFilesSelected}
                  busy={busy}
                  statusMessage={statusMessage}
                  alert={alert}
                  result={result}
                />
                {result !== null ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {NEXT_STEP_NOTE}
                  </p>
                ) : null}
              </>
            ) : null}

            {view.state === "blocked" ? (
              <EmptyState
                icon={AlertTriangle}
                headingLevel={2}
                title={alert?.title ?? "That run could not continue"}
                description={
                  <span className="space-y-2 block">
                    <span className="block whitespace-pre-wrap">
                      {alert?.detail ??
                        view.error ??
                        "The upload was rejected."}
                    </span>
                    {alert?.hint ? (
                      <span className="block">{alert.hint}</span>
                    ) : null}
                  </span>
                }
              />
            ) : null}
          </div>
        </div>
      </div>
    </ProjectsShellWithFreeTier>
  );
}

/**
 * The three-dot creation-flow indicator.
 *
 * DUPLICATED ON PURPOSE, and it is the smallest legal option. The shared
 * component is `features/landing/components/CreationStepIndicator`, and check 6
 * of `scripts/validate-ui-boundary.sh` makes `features/brownfield` importing
 * anything from `features/landing` a build failure — the alias form
 * (`@/landing/...`) included, with an empty, shrink-only baseline. Promoting it
 * to `components/` is a Phase-1-shaped packet touching the landing slice's
 * consumers, which is outside this packet's fence. Flagged for that promotion.
 */
function BrownfieldStepIndicator() {
  const steps = [
    { label: "Method", step: 1 },
    { label: "Configure", step: 2 },
    { label: "Generate", step: 3 },
  ];
  const currentStep = 2;

  return (
    <div className="flex items-center justify-center gap-0 mb-12 animate-fade-in-up">
      {steps.map((step, index) => {
        const isActive = step.step === currentStep;
        const isInactive = step.step > currentStep;
        return (
          <div key={step.step} className="flex items-center">
            {index > 0 ? (
              <div className="w-8 sm:w-16 h-px bg-border mx-1 sm:mx-3" />
            ) : null}
            <div className="flex items-center gap-2">
              <div
                className={
                  isActive
                    ? "w-2 h-2 rounded-full bg-primary step-dot-active"
                    : isInactive
                      ? "w-2 h-2 rounded-full bg-muted"
                      : "w-2 h-2 rounded-full bg-primary"
                }
              />
              <span
                className={
                  isActive
                    ? "text-xs font-medium text-primary"
                    : "text-xs font-medium text-muted-foreground"
                }
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
