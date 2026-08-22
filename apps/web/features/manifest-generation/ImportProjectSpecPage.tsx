"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { InputMode } from "./GenerateWithAi/utils/detect-input-mode";
import {
  detectInputMode,
  parseMultiDocYaml,
} from "./GenerateWithAi/utils/detect-input-mode";
import { logger } from "../../lib/structured-logger";
import { useStagedSpecGeneration } from "./useStagedSpecGeneration";
import { useStagedManifestGeneration } from "./useStagedManifestGeneration";
import type { StageValidationReport } from "../../app/lib/useStagedGenerationStream";
import { useLooseSpecConversion } from "./useLooseSpecConversion";
import { Button } from "@hexagen/ui";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { ProjectsShellWithFreeTier } from "@/ProjectsShellWithFreeTier";
import { useLLMReadiness } from "./hooks/useLLMReadiness";
import { usePendingManifest } from "./store/usePendingManifest";
import {
  useExecutionEngine,
  shouldWarnBeforeGenerate,
  effectivePreferLocal,
  type ExecutionEngine,
} from "./store/useExecutionEngine";
import { ExecutionEngineSelector } from "./ExecutionEngineSelector";
import { LocalGenerationWarningDialog } from "./LocalGenerationWarningDialog";
import { parseManifestToWizardData } from "@hexagen/wizard-orchestration";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";
import { setManifestIdentity } from "./manifestIdentity";

import { SpecUploadStep } from "./import-project-spec/SpecUploadStep";
import { SpecReviewStep } from "./import-project-spec/SpecReviewStep";
import { SpecConvertingStep } from "./import-project-spec/SpecConvertingStep";
import { SpecDescriptionFallbackStep } from "./import-project-spec/SpecDescriptionFallbackStep";
import { ManifestGeneratingStep } from "./import-project-spec/ManifestGeneratingStep";
import { ModelSetupPrompt } from "./GenerateWithAi/ModelSetupPrompt";
import {
  extractSpecSummary,
  type SpecSummary,
} from "./import-project-spec/utils";

type SpecPageState =
  | "UPLOAD"
  | "SPEC_REVIEW"
  | "DESCRIPTION_FALLBACK"
  | "CONVERTING_LOOSE_SPEC"
  | "GENERATING";

/** Model-selection flow with a return hop back to this page (same URL the
 * ModelSetupPrompt below uses). */
const MODEL_SETUP_URL =
  "/projects/new/ai/models?returnUrl=/projects/new/import/spec";

/**
 * True when the uploaded file is already an application-generated manifest — a
 * bounded context carries the derived hexagonal output (`layers.application.ports`
 * or `layers.infrastructure.adapters`). A structured spec never has that (it
 * carries aggregates / domain_models, not `layers`), so this is the discriminator
 * for the fast-path that skips the AI workflow and goes straight to the accept
 * screen. (Run before detectInputMode, which would classify a manifest as
 * "structured-config" since it, too, has a `bounded_contexts` array.)
 */
function isGeneratedManifest(parsed: Record<string, unknown> | null): boolean {
  if (!parsed || !Array.isArray(parsed.bounded_contexts)) return false;
  const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  return (parsed.bounded_contexts as unknown[]).some((c) => {
    const layers = (c as { layers?: unknown }).layers as
      | {
          application?: { ports?: { in?: unknown; out?: unknown } };
          infrastructure?: { adapters?: unknown };
        }
      | undefined;
    if (!layers || typeof layers !== "object") return false;
    const ports = layers.application?.ports;
    return (
      len(ports?.in) > 0 ||
      len(ports?.out) > 0 ||
      len(layers.infrastructure?.adapters) > 0
    );
  });
}

export default function ImportProjectSpecPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pendingManifest = usePendingManifest();
  // Project name carried from the shared Project Name step (`?name=`).
  const carriedName = searchParams.get("name")?.trim() || null;
  const [pageState, setPageState] = useState<SpecPageState>("UPLOAD");
  const [previousState, setPreviousState] = useState<SpecPageState | null>(
    null,
  );
  const [specSummary, setSpecSummary] = useState<SpecSummary | null>(null);
  const [specContent, setSpecContent] = useState<string>("");
  // The user's ORIGINAL upload/paste, preserved for provenance capture at
  // accept-save. `specContent` is overwritten by the loose-spec conversion
  // (the converted JSON), so it can't serve as the honest record. Stays null
  // on the generated-manifest fast path (the manifest IS the artifact —
  // nothing upstream to capture).
  const [originalSpecText, setOriginalSpecText] = useState<string | null>(null);
  const [cameFromConversion, setCameFromConversion] = useState(false);
  const [isJsonDisclosed, setIsJsonDisclosed] = useState(false);
  // Set when a generated manifest fails to parse into wizard data — shown
  // inline on the generating step (there is no preview screen to fall back
  // to; approval happens once, on /projects/new/ai/accept).
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // The successfully generated manifest, parked while the user reviews the
  // telemetry log on the generating step. The footer's "Next" button hands
  // it to acceptManifest.
  const [completedManifest, setCompletedManifest] = useState<string | null>(
    null,
  );
  const { needsSetup, isProbing, preferLocal, isWebLLMReady, hasAnyCloud } =
    useLLMReadiness();
  const { engine, setEngine } = useExecutionEngine();
  // Which generate action is parked behind the local-override warning dialog.
  const [pendingGenerate, setPendingGenerate] = useState<
    "spec" | "description" | null
  >(null);

  // Hook for spec path (structured config)
  const specGeneration = useStagedSpecGeneration();

  // Hook for description fallback path
  const manifestGeneration = useStagedManifestGeneration();

  // Hook for loose spec conversion
  const {
    convert,
    error: conversionError,
    progressMessage: conversionProgressMessage,
    warnings: conversionWarnings,
    reset: resetConversion,
  } = useLooseSpecConversion();

  useEffect(() => {
    const saved = sessionStorage.getItem("import_spec_content");
    if (saved && !specContent) {
      handleFileLoaded(saved, { rehydratedFromSession: true });
    }
  }, []);

  const runConversion = useCallback(
    async (rawContent: string) => {
      setCameFromConversion(true);
      setPageState("CONVERTING_LOOSE_SPEC");
      resetConversion();
      const result = await convert(rawContent, { executionStrategy: engine });
      if (!result.convertedConfig) {
        // Stay in CONVERTING_LOOSE_SPEC; the error UI offers Retry / Continue.
        return;
      }
      try {
        const parsed = JSON.parse(result.convertedConfig);
        setSpecContent(result.convertedConfig);
        sessionStorage.setItem("import_spec_content", result.convertedConfig);
        setSpecSummary(extractSpecSummary(parsed));
        setPageState("SPEC_REVIEW");
      } catch {
        // Hook returned configJson but it's not parseable JSON — surface as a
        // conversion failure so the user gets Retry / Continue options.
        resetConversion();
        setPageState("DESCRIPTION_FALLBACK");
      }
    },
    [convert, resetConversion, engine],
  );

  const handleFileLoaded = (
    content: string,
    options?: { rehydratedFromSession?: boolean },
  ) => {
    setAcceptError(null);
    // Parse once: reused for the manifest fast-path AND the spec summary
    // (supports single- and multi-document YAML / JSON, strict on key conflicts).
    const parsed = parseMultiDocYaml(content);

    // Fast-path: a complete application-generated manifest already carries the
    // derived hexagonal layers (ports/adapters), so there is nothing for the AI
    // workflow to do — hand it straight to the accept screen. acceptManifest
    // surfaces any parse failure via acceptError (shown on the upload step). A
    // structured spec falls through to the AI flow below.
    if (isGeneratedManifest(parsed)) {
      // Also clear any spec persisted by an earlier upload this session, so the
      // accept screen's Back returns to a clean upload page rather than
      // rehydrating stale content — and drop any earlier upload's provenance so
      // it can't attach to this unrelated manifest. The explicit `null`s to
      // acceptManifest are load-bearing: setOriginalSpecText hasn't re-rendered
      // yet, so acceptManifest's closure still sees the PREVIOUS upload's text —
      // and an earlier abandoned generation run could have left a stale Stage-6
      // report on the hooks that must not attach to this hand-uploaded manifest.
      sessionStorage.removeItem("import_spec_content");
      sessionStorage.removeItem("import_spec_original_content");
      setOriginalSpecText(null);
      acceptManifest(content, null, null);
      return;
    }

    // Persist ONLY for the spec/AI paths. A generated manifest fast-paths to the
    // accept screen; persisting it would let the accept screen's Back rehydrate
    // this page from sessionStorage and immediately re-fast-path — an infinite
    // Back→Accept loop.
    sessionStorage.setItem("import_spec_content", content);
    if (options?.rehydratedFromSession) {
      // On reload, import_spec_content may hold the post-conversion JSON (the
      // conversion overwrites it so this step rehydrates correctly). The user's
      // ORIGINAL words live under the dedicated key; fall back to the current
      // content only when it's absent (pre-key session).
      setOriginalSpecText(
        sessionStorage.getItem("import_spec_original_content") ?? content,
      );
    } else {
      sessionStorage.setItem("import_spec_original_content", content);
      setOriginalSpecText(content);
    }

    const mode: InputMode = detectInputMode(content);

    if (mode === "structured-config") {
      setCameFromConversion(false);
      // Clear any prior loose-spec conversion state so a deterministic upload
      // after an earlier conversion doesn't carry stale warnings into review
      // (qodo #410). SpecReviewStep also gates warnings on cameFromConversion.
      resetConversion();
      setSpecContent(content);
      setPageState("SPEC_REVIEW");
      setSpecSummary(parsed ? extractSpecSummary(parsed) : null);
    } else if (mode === "semi-structured") {
      setSpecContent(content);
      void runConversion(content);
    } else {
      setCameFromConversion(false);
      setSpecContent(content);
      setPageState("DESCRIPTION_FALLBACK");
    }
  };

  // Runs on the footer's "Next" click after generation completes (the page
  // stays on the generating step so the user can review the telemetry log):
  // reconcile the carried project name into the manifest, stash it for the
  // accept screen, and navigate to /projects/new/ai/accept — the single
  // approval screen. (The page used to show its own PREVIEW state first,
  // duplicating the accept screen.)
  const acceptManifest = useCallback(
    // `originSpecTextOverride`: the fast path passes an explicit `null` because
    // its setOriginalSpecText(null) hasn't re-rendered yet — this closure would
    // otherwise still read the previous upload's text and attach it to an
    // unrelated manifest. Callers after a render cycle (the generating step's
    // Next button) omit it and get the state value.
    // `validationReportOverride`: same override pattern for the Stage-6
    // report. The fast path passes an explicit `null` — its manifest never
    // went through the pipeline, but a generation run abandoned earlier in
    // this page session could have left a stale report on the hooks. Omitted
    // by the generating step's Next, which wants the live report.
    // `validationPending` (Part B-lite): true when the user continued with
    // the EARLY Stage-5 manifest while the Stage-6 review was still
    // streaming — stored so the accept view notes findings are unavailable.
    (
      manifest: string,
      originSpecTextOverride?: string | null,
      validationReportOverride?: StageValidationReport | null,
      validationPending?: boolean,
    ) => {
      try {
        const wizardData = parseManifestToWizardData(manifest);
        // The user-entered name (from the Project Name step) wins: it becomes the
        // saved-project name and seeds `governance.workspaceName` so the name is
        // factored into generated output. Fall back to the manifest-derived name
        // only if the step was bypassed (e.g. a direct visit to this page).
        const projectName =
          carriedName ||
          wizardData.governance?.workspaceName ||
          `Imported Project ${new Date().toLocaleTimeString()}`;
        // Keep the saved manifest string in sync with the carried name:
        // seed the form's workspaceName/namespacePrefix AND rewrite the manifest's
        // top-level system/scope so the Approve screen and saved manifestYaml
        // agree with formState (see manifestIdentity).
        let manifestYaml = manifest;
        if (carriedName && wizardData.governance) {
          const slug = deriveWorkspaceName(carriedName).name;
          const scope = `@${slug}`;
          wizardData.governance.workspaceName = slug;
          wizardData.governance.namespacePrefix = scope;
          manifestYaml = setManifestIdentity(manifest, {
            system: slug,
            scope,
          });
        }
        // originPath lets the accept screen's Back/Regenerate return to THIS
        // flow (the spec survives in sessionStorage) instead of the prompt flow.
        // originSpecText rides along so the accept-save can attach the user's
        // ORIGINAL spec as a planning layer (null on the manifest fast path).
        // The Stage-6 report rides along too, so the accept view trusts the
        // pipeline's validation instead of re-padding via the client fixer.
        // The ??-coalesce over the two hooks is exact, not a guess: each run
        // function resets the OTHER hook before generating, so at most one
        // report is non-null. (The identity rewrite above only touches
        // top-level system/scope, which the Stage-6 review does not key on —
        // its findings stay valid for the stored YAML.)
        pendingManifest.set(
          manifestYaml,
          wizardData,
          projectName,
          "/projects/new/import/spec",
          originSpecTextOverride === undefined
            ? originalSpecText
            : originSpecTextOverride,
          validationReportOverride === undefined
            ? (specGeneration.validationReport ??
                manifestGeneration.validationReport)
            : validationReportOverride,
          validationPending ?? false,
        );
        // User-click navigation (the footer's Next / the manifest fast
        // path's explicit upload) — never an auto-navigate from a stream
        // success arm.
        router.push("/projects/new/ai/accept");
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // Log in prod too: this failure previously left NO trace anywhere
        // (client showed a fixed string, server had already reported success),
        // which made a schema-invalid generated manifest undiagnosable post-hoc.
        logger.error("Failed to parse manifest for wizard:", {
          error: errorMsg,
        });
        // Surface the failure inline on the generating step and retire the
        // Next button (a re-click would fail identically); the footer's
        // "Go Back" is the way out. Quote the real cause (truncated) — the
        // parser's message names the offending fields.
        setCompletedManifest(null);
        const detail =
          errorMsg.length > 300 ? `${errorMsg.slice(0, 300)}…` : errorMsg;
        setAcceptError(
          `The generated manifest could not be parsed (${detail}). Go back and try again.`,
        );
      }
    },
    [
      pendingManifest,
      router,
      carriedName,
      originalSpecText,
      specGeneration.validationReport,
      manifestGeneration.validationReport,
    ],
  );

  // Shared completion handling for the spec path — the original run and the
  // footer's Retry (which re-enters via specGeneration.retry()) must land the
  // result identically.
  const applySpecResult = useCallback(
    (result: Awaited<ReturnType<typeof specGeneration.generateFromSpec>>) => {
      if (result?.generatedManifest?.trim()) {
        // Stay on the generating step (telemetry log stays reviewable);
        // the footer's "Next" button carries the manifest forward.
        setCompletedManifest(result.generatedManifest);
      } else if (result?.phase === "failed") {
        const errorMsg = result.stepDetail || "";
        if (errorMsg.includes("No cloud LLM API keys configured")) {
          // Spec generation cannot run locally via WebLLM on the backend.
          // Fallback to the description mode which uses the local-capable useStagedManifestGeneration.
          setPageState("DESCRIPTION_FALLBACK");
        }
        // Other failures: specGeneration.generationError is set by executeCloudGeneration,
        // so ManifestGeneratingStep will display the error. The "Go Back" and
        // "Retry" buttons are shown when isGenerating=false, so the user can recover.
      } else if (result) {
        // Completed without a manifest (e.g. the endpoint reported success but
        // streamed an empty document): without this branch the page would park
        // on GENERATING with neither a Next button nor an error. `undefined`
        // result = user abort, which keeps the silent "Go Back" exit.
        setAcceptError(
          "Generation finished without producing a manifest. Go back and try again.",
        );
      }
    },
    [specGeneration],
  );

  const runSpecGeneration = useCallback(
    async (strategy: ExecutionEngine) => {
      // Retry re-enters generation while the page is already on GENERATING;
      // overwriting previousState with "GENERATING" would turn the footer's
      // Go Back into a no-op loop, so only record a genuine origin state.
      if (pageState !== "GENERATING") setPreviousState(pageState);
      setPageState("GENERATING");
      setAcceptError(null);
      setCompletedManifest(null);
      manifestGeneration.reset();

      applySpecResult(
        await specGeneration.generateFromSpec(specContent, {
          executionStrategy: strategy,
        }),
      );
    },
    [
      specContent,
      specGeneration,
      manifestGeneration,
      pageState,
      applySpecResult,
    ],
  );

  const runDescriptionGeneration = useCallback(
    async (strategy: ExecutionEngine) => {
      // Same GENERATING guard as runSpecGeneration: Retry must not clobber
      // the origin state the footer's Go Back returns to.
      if (pageState !== "GENERATING") setPreviousState(pageState);
      setPageState("GENERATING");
      setAcceptError(null);
      setCompletedManifest(null);
      specGeneration.reset();

      const result = await manifestGeneration.generateManifest(specContent, {
        preferLocal: effectivePreferLocal(strategy, preferLocal),
      });

      if (result?.generatedManifest?.trim()) {
        setCompletedManifest(result.generatedManifest);
      } else if (result?.generationError) {
        setPageState("DESCRIPTION_FALLBACK");
      } else if (result) {
        // Same no-manifest/no-error guard as runSpecGeneration above. The
        // hook now converts an empty local render into generationError (the
        // branch above), so this is the cloud-path backstop.
        setAcceptError(
          "Generation finished without producing a manifest. Go back and try again.",
        );
      }
    },
    [specContent, manifestGeneration, specGeneration, pageState, preferLocal],
  );

  // Footer Retry after a failed run parked on the generating step. The spec
  // path re-enters via the hook's retry() (same spec + options as the failed
  // attempt); the description path re-runs with the current engine. previousState
  // discriminates the two: description runs only start from DESCRIPTION_FALLBACK,
  // spec runs from SPEC_REVIEW (and the GENERATING guard above keeps it stable
  // across retries).
  const handleRetry = useCallback(async () => {
    if (previousState === "DESCRIPTION_FALLBACK") {
      void runDescriptionGeneration(engine);
      return;
    }
    setAcceptError(null);
    setCompletedManifest(null);
    applySpecResult(await specGeneration.retry());
  }, [
    previousState,
    engine,
    runDescriptionGeneration,
    specGeneration,
    applySpecResult,
  ]);

  const handleMapPorts = useCallback(() => {
    if (needsSetup) return;
    if (shouldWarnBeforeGenerate(engine)) {
      setPendingGenerate("spec");
      return;
    }
    // Auto-resolved local with no model loaded would resolve the strategy to
    // "none" and fail; detour through model selection instead (explicit local
    // gets the same detour from the warning dialog's Continue action).
    if (effectivePreferLocal(engine, preferLocal) && !isWebLLMReady) {
      router.push(MODEL_SETUP_URL);
      return;
    }
    void runSpecGeneration(engine);
  }, [
    needsSetup,
    engine,
    preferLocal,
    isWebLLMReady,
    router,
    runSpecGeneration,
  ]);

  const handleContinue = useCallback(() => {
    if (needsSetup) return;
    if (shouldWarnBeforeGenerate(engine)) {
      setPendingGenerate("description");
      return;
    }
    if (effectivePreferLocal(engine, preferLocal) && !isWebLLMReady) {
      router.push(MODEL_SETUP_URL);
      return;
    }
    void runDescriptionGeneration(engine);
  }, [
    needsSetup,
    engine,
    preferLocal,
    isWebLLMReady,
    router,
    runDescriptionGeneration,
  ]);

  // Warning-dialog actions. The run functions take the strategy explicitly
  // because "Switch to cloud" must run with the freshly chosen engine — the
  // `engine` value captured in this render is still "local".
  const resolvePendingGenerate = useCallback(
    (strategy: ExecutionEngine) => {
      const pending = pendingGenerate;
      setPendingGenerate(null);
      if (pending === "spec") void runSpecGeneration(strategy);
      else if (pending === "description")
        void runDescriptionGeneration(strategy);
    },
    [pendingGenerate, runSpecGeneration, runDescriptionGeneration],
  );

  const handleContinueLocal = useCallback(() => {
    // Explicit local with no model loaded: generating would resolve the
    // strategy to "none" and fail. Mirror GenerateWithAi's detour through
    // model selection (returnUrl brings the user back here to re-trigger).
    if (!isWebLLMReady) {
      setPendingGenerate(null);
      router.push(MODEL_SETUP_URL);
      return;
    }
    resolvePendingGenerate("local");
  }, [isWebLLMReady, router, resolvePendingGenerate]);

  const handleSwitchToCloud = useCallback(() => {
    setEngine("cloud");
    resolvePendingGenerate("cloud");
  }, [setEngine, resolvePendingGenerate]);

  const handleBack = () => {
    if (pageState === "SPEC_REVIEW" || pageState === "DESCRIPTION_FALLBACK") {
      setPageState("UPLOAD");
      setSpecSummary(null);
      setSpecContent("");
      setOriginalSpecText(null);
      sessionStorage.removeItem("import_spec_content");
      sessionStorage.removeItem("import_spec_original_content");
    } else {
      router.push("/projects/new/import");
    }
  };

  const handleReset = () => {
    specGeneration.reset();
    manifestGeneration.reset();
    resetConversion();
    setAcceptError(null);
    setCompletedManifest(null);
    setPageState("UPLOAD");
    setSpecContent("");
    setSpecSummary(null);
    setOriginalSpecText(null);
    setCameFromConversion(false);
    setIsJsonDisclosed(false);
    sessionStorage.removeItem("import_spec_content");
    sessionStorage.removeItem("import_spec_original_content");
  };

  const generationError =
    acceptError ||
    specGeneration.generationError ||
    manifestGeneration.generationError;
  const phase =
    specGeneration.phase !== "idle"
      ? specGeneration.phase
      : manifestGeneration.phase;
  const stepDetail = specGeneration.stepDetail || manifestGeneration.stepDetail;
  const stageProgress =
    specGeneration.stageProgress || manifestGeneration.stageProgress;
  const verboseLog = specGeneration.verboseLog;

  const renderFooter = () => {
    if (pageState === "SPEC_REVIEW") {
      return (
        <>
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button type="button" onClick={handleMapPorts}>
            Map Ports & Adapters
          </Button>
        </>
      );
    }
    if (pageState === "DESCRIPTION_FALLBACK") {
      return (
        <>
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => router.push("/projects/new/ai")}
            >
              Generate with AI instead
            </Button>
            <Button onClick={handleContinue}>Continue anyway</Button>
          </div>
        </>
      );
    }
    if (pageState === "CONVERTING_LOOSE_SPEC") {
      // When conversion has failed, offer recovery paths. While in flight,
      // only Cancel is available.
      if (conversionError) {
        return (
          <>
            <Button variant="outline" onClick={handleReset}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPageState("DESCRIPTION_FALLBACK");
                  resetConversion();
                  setCameFromConversion(false);
                }}
              >
                Continue as description
              </Button>
              <Button onClick={() => void runConversion(specContent)}>
                Retry conversion
              </Button>
            </div>
          </>
        );
      }
      return (
        <>
          <Button
            variant="outline"
            onClick={() => {
              resetConversion();
              setPageState("UPLOAD");
              setSpecContent("");
              setOriginalSpecText(null);
              setCameFromConversion(false);
              sessionStorage.removeItem("import_spec_content");
              sessionStorage.removeItem("import_spec_original_content");
            }}
          >
            Cancel
          </Button>
          <span />
        </>
      );
    }
    if (pageState === "GENERATING") {
      const isRunning =
        specGeneration.isGenerating || manifestGeneration.isGenerating;
      // Early Stage-5 manifest (Part B-lite): each run function resets the
      // OTHER hook before generating, so at most one is non-null. Offered
      // only while the run is in flight — after completion the parked
      // completedManifest Next below wins, and a failed run offers neither.
      const earlyManifest = isRunning
        ? (specGeneration.earlyManifest ?? manifestGeneration.earlyManifest)
        : null;
      // The Stage-7 verify-and-repair pass changed the yaml between the
      // early frame and `done` — surfaced as a subtle informational note.
      const finalEarly =
        specGeneration.earlyManifest ?? manifestGeneration.earlyManifest;
      const manifestUpdatedByRepair = Boolean(
        !isRunning &&
        completedManifest &&
        finalEarly &&
        finalEarly !== completedManifest,
      );
      return (
        <>
          {manifestUpdatedByRepair ? (
            <span className="text-xs text-muted-foreground self-center">
              Manifest updated by validation repair
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {/* "Validating…" affordance: the manifest is ready and Next is
                usable, but Stage 6 is still reviewing — continuing now means
                the accept view shows findings as unavailable. */}
            {isRunning && earlyManifest && !acceptError && (
              <span
                className="text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                Validating manifest…
              </span>
            )}
            <Button
              variant="outline"
              onClick={() => {
                specGeneration.reset();
                manifestGeneration.reset();
                setAcceptError(null);
                setCompletedManifest(null);
                setPageState(previousState ?? "SPEC_REVIEW");
                setPreviousState(null);
              }}
            >
              {isRunning ? "Cancel" : "Go Back"}
            </Button>
            {/* Failed run (stream death, timeout, empty manifest, parse
                failure): offer an explicit Retry beside Go Back. The stream's
                terminal-frame accounting now guarantees dead streams reach
                this resting state instead of spinning forever. */}
            {!isRunning && !completedManifest && generationError && (
              <Button onClick={() => void handleRetry()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            )}
            {/* Generation succeeded: let the user review the telemetry log
                at their own pace; Next carries the manifest to the accept
                screen. */}
            {!isRunning && completedManifest && (
              <Button onClick={() => acceptManifest(completedManifest)}>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
            {/* Early-enable Next (Part B-lite): the user may continue with
                the Stage-5 manifest without waiting for the review. Explicit
                null report + validationPending — no findings exist yet, and
                navigating kills the component-owned stream, so none will
                arrive. User-click only; never auto-navigated. */}
            {isRunning && earlyManifest && !acceptError && (
              <Button
                onClick={() =>
                  acceptManifest(earlyManifest, undefined, null, true)
                }
              >
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </>
      );
    }
    return (
      <>
        <Button variant="outline" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <span />
      </>
    );
  };

  const isFullHeightState = pageState === "GENERATING";

  return (
    <ProjectsShellWithFreeTier
      headerContent={
        <span className="font-semibold text-sm truncate">
          Import Manifest or Spec
        </span>
      }
      footer={renderFooter()}
    >
      {isFullHeightState ? (
        <div className="h-full flex flex-col dot-grid bg-ambient p-4">
          <ManifestGeneratingStep
            generationError={generationError}
            phase={phase}
            stepDetail={stepDetail}
            stageProgress={stageProgress}
            verboseLog={verboseLog}
            validationReport={specGeneration.validationReport}
            repairSummary={specGeneration.repairSummary}
          />
        </div>
      ) : (
        <div className="h-full overflow-y-auto dot-grid bg-ambient">
          <div className="max-w-2xl mx-auto py-8 px-4">
            {(pageState === "SPEC_REVIEW" ||
              pageState === "DESCRIPTION_FALLBACK") &&
              needsSetup &&
              !isProbing && (
                <div className="mb-6">
                  <ModelSetupPrompt
                    onSetupModel={() => router.push(MODEL_SETUP_URL)}
                  />
                </div>
              )}

            {pageState === "UPLOAD" && (
              <div className="space-y-4">
                <SpecUploadStep onFileLoaded={handleFileLoaded} />
                {acceptError && (
                  <p
                    role="alert"
                    className="text-sm text-red-600 dark:text-red-400"
                  >
                    {acceptError}
                  </p>
                )}
              </div>
            )}

            {pageState === "SPEC_REVIEW" && (
              <div className="space-y-6">
                <SpecReviewStep
                  specSummary={specSummary}
                  specContent={specContent}
                  cameFromConversion={cameFromConversion}
                  conversionWarnings={conversionWarnings}
                  isJsonDisclosed={isJsonDisclosed}
                  onToggleJsonDisclosed={setIsJsonDisclosed}
                />
                <ExecutionEngineSelector
                  engine={engine}
                  onEngineChange={setEngine}
                />
              </div>
            )}

            {pageState === "CONVERTING_LOOSE_SPEC" && (
              <SpecConvertingStep
                conversionError={conversionError}
                progressMessage={conversionProgressMessage}
              />
            )}

            {pageState === "DESCRIPTION_FALLBACK" && (
              <div className="space-y-6">
                <SpecDescriptionFallbackStep />
                <ExecutionEngineSelector
                  engine={engine}
                  onEngineChange={setEngine}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <LocalGenerationWarningDialog
        open={pendingGenerate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingGenerate(null);
        }}
        onContinueLocal={handleContinueLocal}
        onSwitchToCloud={handleSwitchToCloud}
        canSwitchToCloud={hasAnyCloud}
      />
    </ProjectsShellWithFreeTier>
  );
}
