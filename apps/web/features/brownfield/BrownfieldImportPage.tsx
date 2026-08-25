"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
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
  type BrownfieldFlowState,
  type BrownfieldFlowViewState,
  type BrownfieldGateInstallMode,
  type BrownfieldLayoutDraft,
  type BrownfieldManifestDraft,
  type BrownfieldTier,
} from "./BrownfieldFlow/types";
import {
  deriveScanId,
  freshFindingCountOf,
  packagesFromLayoutDraft,
  readDetectedPackages,
  scanFromHandoff,
} from "./BrownfieldFlow/scan-artifacts";
import { useBrownfieldDraft } from "./draft/useBrownfieldDraft";
import { useGithubScanAvailability } from "./ScanProgress/useGithubScanAvailability";
import { FindingsReview } from "./FindingsReview/FindingsReview";
import { LayoutRatify } from "./LayoutRatify/LayoutRatify";
import { ManifestRatify } from "./ManifestRatify/ManifestRatify";
import { createManifestDraft } from "./ManifestRatify/manifest-draft";
import { Report } from "./Report/Report";
import { ArtifactUploadView } from "./views/ArtifactUploadView";
import type { ArtifactUploadAlert } from "./views/ArtifactUploadView";
import {
  BrownfieldNotice,
  BrownfieldScreenFrame,
} from "./views/BrownfieldScreenFrame";
import { BrownfieldStepIndicator } from "./views/BrownfieldStepIndicator";
import { TierPickerView } from "./views/TierPickerView";

import { fetchWithCsrf } from "@/lib/csrf-fetch";
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
 * ## This is now the whole flow, not the first three states
 *
 * It drives every state the machine defines: `tier_pick`, `uploading` and
 * `blocked` as before, and now `layout_ratify`, `manifest_ratify`,
 * `findings_review`, `report` and `gate_install` as well. Before that wiring the
 * five ratification slices were complete, tested and imported by nothing, which
 * meant `SCAN_COMPLETE` could never be dispatched: its target state had nothing
 * to render, so dispatching it would have blanked the page.
 *
 * ## How `SCAN_COMPLETE` is dispatched, and why not automatically
 *
 * A successful ingest still lands on the upload screen with the parse result in
 * place. The footer then offers an explicit **Continue** button, and pressing it
 * folds TWO events through the machine — `UPLOAD_COMPLETE` (uploading ->
 * scanning) then `SCAN_COMPLETE` (scanning -> layout_ratify). Two, because the
 * transition table has no `uploading -> layout_ratify` edge and reaching around
 * it would give away the property BF-3.1 encoded. `scanning` is instantaneous
 * for Tier A — the parse already happened inside the POST — so it is a state the
 * flow passes THROUGH rather than one it renders.
 *
 * The success arm still performs no navigation of its own. The user reads the
 * ingest result and moves on by pressing something, which is the standing house
 * rule for a flow that ends on a result screen and is doubly true of `report`,
 * which the machine makes terminal-with-actions.
 *
 * ## What is NOT wired here, and is flagged rather than faked
 *
 * The ratified manifest is held in the flow state; it is NOT yet POSTed to
 * `/api/projects/bootstrap` (BF-4.3). That route exists and works, but wiring it
 * needs its own error surface, and inventing a silent one would be worse than an
 * honest gap. The gate bundle the user takes away does not depend on it — the
 * install-gate route builds from `scanId` alone.
 */

/**
 * The seam note under a finished Tier-A ingest. Now says what Continue does
 * rather than announcing a future release.
 */
const NEXT_STEP_NOTE =
  "Nothing you uploaded was stored. Continue to confirm the layout these artifacts describe, then take away a conformance gate.";

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

export function isHandoffResponse(
  value: unknown,
): value is ProjectHandoffResponse {
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
          ? 'A handoff zip is a handful of small text files. If yours is large you probably zipped the repository — that is the "Upload a zip" tier, not this one.'
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

  /**
   * Whether THIS deployment runs the Tier-B endpoint. One cheap GET, the same
   * probe the scan screen uses (`useGithubScanAvailability`), because the tier
   * picker has to be as truthful about server-side cloning as the screen it
   * leads to. `unknown` means the probe failed and is treated as "let the user
   * try": the POST is the only authority on whether the endpoint is there.
   */
  const { availability: cloneAvailability } = useGithubScanAvailability();
  const cloneIsWorthTrying =
    cloneAvailability === "available" || cloneAvailability === "unknown";

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

  /** Fold a sequence of events through the machine, left to right. */
  const foldEvents = useCallback(
    (from: BrownfieldFlowState, events: BrownfieldFlowEvent[]) =>
      events.reduce(deriveStateFromEvent, from),
    [],
  );

  /**
   * One correlation id per mounted run, captured once.
   *
   * It names the gate bundle the user downloads, so it must not change while
   * they are looking at the screen that offers it — a `Date.now()` read per
   * render would rename the file on every keystroke. The install-gate route
   * treats `scanId` as a name rather than a lookup key (it says so: there is no
   * `ScanRecord` store to look one up in), so deriving it locally is the whole
   * contract, and `deriveScanId` guarantees the route's allow-list by
   * construction.
   */
  const [runSuffix] = useState(() => Date.now().toString(36));
  const scanId = useMemo(
    () => deriveScanId(carriedName, runSuffix),
    [carriedName, runSuffix],
  );

  /**
   * The ingest, in the shape S6 reads. Null until the upload succeeds, and null
   * again on a resumed run — a scan is server state and BF-3.4 deliberately does
   * not persist it.
   */
  const scan = useMemo(
    () => (result === null ? null : scanFromHandoff(result)),
    [result],
  );

  /**
   * The detected packages S3 edits — the join this flow was missing.
   *
   * LIVE SCAN FIRST, draft projection second. When the run produced artifacts,
   * the packages come from the returned `layout.yaml` text. On a resumed run
   * there is no scan, and `resolveResumeState` still permits `layout_ratify`
   * because the ratified draft is persisted; `packagesFromLayoutDraft` rebuilds
   * the rows from it so the screen shows what the user confirmed rather than an
   * empty grid. See that function's docblock for what the rebuild loses.
   */
  const detected = useMemo(
    () => readDetectedPackages(scan?.layoutExcerpt ?? null),
    [scan],
  );
  const resumedPackages = useMemo(
    () => packagesFromLayoutDraft(view.layoutDraft),
    [view.layoutDraft],
  );
  const layoutPackages = scan === null ? resumedPackages : detected.packages;
  const layoutProblem =
    scan !== null
      ? detected.problem
      : resumedPackages.length === 0
        ? "This run was resumed and its scan is gone, so there is nothing to confirm. Start again from the import options."
        : null;

  /**
   * S4's draft. Seeded from what S3 ratified the first time the screen is
   * reached, then held in the flow state so S5 -> S4 shows what the user typed.
   */
  const manifestDraft = useMemo(
    () =>
      view.manifestDraft ??
      createManifestDraft(view.layoutDraft ?? { contexts: [] }, carriedName),
    [view.manifestDraft, view.layoutDraft, carriedName],
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
      const response = await fetchWithCsrf("/api/projects/scan/artifacts", {
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
      return;
    }
    if (tier === "clone") {
      // Tier B ships too (BF-5.3). The button below is already disabled while
      // the endpoint is known-absent or still being probed; re-checking here
      // means a restored draft carrying `clone` cannot navigate to a 404 by
      // some path that bypasses the footer.
      if (!cloneIsWorthTrying) return;
      // The scan screen owns its own name field, but accepts a carried one and
      // prefills from it — same `?name=` contract as the zip tier.
      router.push(
        `/projects/new/import/github?name=${encodeURIComponent(carriedName)}`,
      );
    }
  }, [
    view.tier,
    dispatch,
    resetUpload,
    router,
    carriedName,
    cloneIsWorthTrying,
  ]);

  const startOver = useCallback(() => {
    resetUpload();
    dispatch({ type: "TRY_ANOTHER_TIER" });
  }, [resetUpload, dispatch]);

  const toImportOptions = useCallback(() => {
    router.push("/projects/new/import");
  }, [router]);

  const goBack = useCallback(() => {
    dispatch({ type: "GO_BACK" });
  }, [dispatch]);

  /**
   * The one place `SCAN_COMPLETE` is raised.
   *
   * TWO events, not one. `uploading -> layout_ratify` is not an edge the table
   * permits, so `SCAN_COMPLETE` alone would be inert — `transitionState` would
   * hand back `uploading` and the button would appear broken. `UPLOAD_COMPLETE`
   * moves to `scanning` first, which for Tier A is a state with no duration
   * (the parse finished inside the POST) and therefore nothing to render.
   */
  const continueToRatification = useCallback(() => {
    applyView({
      ...view,
      state: foldEvents(view.state, [
        { type: "UPLOAD_COMPLETE" },
        { type: "SCAN_COMPLETE" },
      ]),
    });
  }, [view, applyView, foldEvents]);

  const handleLayoutDraftChange = useCallback(
    (layoutDraft: BrownfieldLayoutDraft) => {
      applyView({ ...view, layoutDraft });
    },
    [view, applyView],
  );

  /**
   * Ratifying the layout also DROPS a manifest draft seeded from an older one.
   *
   * S4's contexts are seeded from S3's output, so walking back, changing which
   * packages are included and returning would otherwise show a context list
   * that no longer matches the layout the user just confirmed. The draft is
   * only discarded when the ratified layout actually differs.
   */
  const handleRatifyLayout = useCallback(
    (layoutDraft: BrownfieldLayoutDraft) => {
      const layoutChanged =
        JSON.stringify(view.layoutDraft ?? null) !==
        JSON.stringify(layoutDraft);
      dispatch(
        { type: "RATIFY_LAYOUT" },
        {
          layoutDraft,
          manifestDraft: layoutChanged ? null : (view.manifestDraft ?? null),
        },
      );
    },
    [dispatch, view.layoutDraft, view.manifestDraft],
  );

  const handleManifestDraftChange = useCallback(
    (next: BrownfieldManifestDraft) => {
      applyView({ ...view, manifestDraft: next });
    },
    [view, applyView],
  );

  /**
   * `freshFindingCount` is the REAL count, never a convenient zero.
   *
   * The machine skips `findings_review` only on an explicit `0`, and its comment
   * explains why a `> 0` test would be wrong. `freshFindingCountOf` returns a
   * negative sentinel when the scan reported no findings list at all — which is
   * the case for every Tier-A handoff today — so the user is routed TO the review
   * screen, where the copy says an unread list is not an empty one. Defaulting to
   * `0` here would skip the screen and present an unmeasured tree as clean.
   */
  const handleRatifyManifest = useCallback(
    (_payload: unknown, draft: BrownfieldManifestDraft) => {
      dispatch(
        {
          type: "RATIFY_MANIFEST",
          freshFindingCount: freshFindingCountOf({
            findings: scan?.findings ?? null,
          }),
        },
        { manifestDraft: draft },
      );
    },
    [dispatch, scan],
  );

  const handleDecisionsChange = useCallback(
    (baselinedFindingKeys: string[]) => {
      applyView({ ...view, baselinedFindingKeys });
    },
    [view, applyView],
  );

  const handleRatifyFindings = useCallback(
    (baselinedFindingKeys: string[]) => {
      dispatch({ type: "RATIFY_FINDINGS" }, { baselinedFindingKeys });
    },
    [dispatch],
  );

  const handleInstallGate = useCallback(() => {
    dispatch({ type: "INSTALL_GATE" });
  }, [dispatch]);

  /**
   * Records WHICH way the gate was taken, and does nothing else. Not a
   * navigation trigger: this is a success arm, and success arms do not route.
   */
  const handleGateDelivered = useCallback(
    (gateInstallMode: BrownfieldGateInstallMode) => {
      applyView({ ...view, gateInstallMode });
    },
    [view, applyView],
  );

  if (!carriedName) return null;

  // ── S3–S7 ──────────────────────────────────────────────────────────────────
  //
  // Each ratification screen renders its OWN shell, because each owns its own
  // footer actions and its own content width (the plan gives S1 `max-w-3xl` and
  // the dense S3 `max-w-4xl`). A single shared shell can express neither, and
  // mounting the screens conditionally is also what keeps their hooks
  // conditional — `useScanReport` needs a scan, and there is none to give it on
  // the tier picker.

  if (view.state === "layout_ratify") {
    return (
      <LayoutRatify
        packages={layoutPackages}
        ratifiedDraft={view.layoutDraft ?? null}
        projectName={carriedName}
        detectionProblem={layoutProblem}
        onDraftChange={handleLayoutDraftChange}
        onRatify={handleRatifyLayout}
        onBack={goBack}
      />
    );
  }

  if (view.state === "manifest_ratify") {
    // S4 is the one screen whose view renders its own Back/Continue inside the
    // content column, so its shell footer carries only the way out of the flow.
    // That is `ManifestRatifyView`'s existing choice, not a new convention.
    return (
      <BrownfieldScreenFrame
        measure="wide"
        footer={
          <Button variant="outline" onClick={toImportOptions}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to import options
          </Button>
        }
      >
        <ManifestRatify
          draft={manifestDraft}
          onDraftChange={handleManifestDraftChange}
          onBack={goBack}
          onRatify={handleRatifyManifest}
        />
      </BrownfieldScreenFrame>
    );
  }

  if (view.state === "findings_review") {
    return (
      <FindingsReview
        findings={scan?.findings ?? null}
        ratifiedKeys={view.baselinedFindingKeys ?? null}
        projectName={carriedName}
        onDecisionsChange={handleDecisionsChange}
        onRatify={handleRatifyFindings}
        onBack={goBack}
      />
    );
  }

  // `gate_install` renders the SAME screen: S7 is a dialog over the report, not
  // a page, and `gate_install` has no outgoing edge — so a host that switched on
  // `report` alone would blank the page the moment the installer opened.
  if (view.state === "report" || view.state === "gate_install") {
    if (scan === null) {
      // Reachable only by a restored draft, which cannot carry a scan. Saying so
      // is the honest arm; rendering a report assembled from nothing is not.
      return (
        <BrownfieldScreenFrame
          footer={
            <Button onClick={toImportOptions}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to import options
            </Button>
          }
        >
          <BrownfieldNotice assertive>
            This run was resumed, and a scan report is not something that can be
            restored — it describes a repository as it was when it was read.
            Start the import again to produce one.
          </BrownfieldNotice>
        </BrownfieldScreenFrame>
      );
    }
    return (
      <Report
        scan={scan}
        scanId={scanId}
        onInstallGate={handleInstallGate}
        onGateDelivered={handleGateDelivered}
        onExit={toImportOptions}
      />
    );
  }

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
        // Continue is offered ONLY for an ingested handoff. `verdict` is
        // `incomplete` exactly when no report came back, and S3 ratifies a
        // layout derived from that report — so advancing would put the user on
        // a screen with nothing to ratify, and Back from S3 goes to the tier
        // picker rather than here, turning a retryable upload into a restart.
        //
        // Keeping the incomplete case on this screen keeps the retry loop
        // where the user already is, next to the reason it failed.
        const canRatify = result.verdict === "ingested";
        return (
          <>
            <Button variant="outline" onClick={resetUpload} disabled={busy}>
              Upload different artifacts
            </Button>
            {/*
              The ONLY place `SCAN_COMPLETE` is raised, and a button rather than
              an effect. `continueToRatification` folds UPLOAD_COMPLETE then
              SCAN_COMPLETE — see its docblock for why two events.
            */}
            {canRatify ? (
              <Button onClick={continueToRatification} disabled={busy}>
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : null}
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
            // "clone" is no longer disabled outright — BF-5.3 shipped the
            // screen it leads to. It is disabled only while the deployment has
            // said it does not run the endpoint, or has not answered yet: an
            // enabled button that lands on a 404 is worse than a disabled one,
            // and a draft can restore `clone` on a deployment that has it off.
            (view.tier ?? null) === null ||
            nameTooLong ||
            (view.tier === "clone" && !cloneIsWorthTrying)
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
                cloneAvailability={cloneAvailability}
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
