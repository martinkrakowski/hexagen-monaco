"use client";

import { useState, useCallback, Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { InputMode } from "./GenerateWithAi/utils/detect-input-mode";
import { detectInputMode } from "./GenerateWithAi/utils/detect-input-mode";
import yaml from "js-yaml";
import { useStagedSpecGeneration } from "./useStagedSpecGeneration";
import { useStagedManifestGeneration } from "./useStagedManifestGeneration";
import { useLooseSpecConversion } from "./useLooseSpecConversion";
import { ThinkingBlock } from "./GenerateWithAi/ThinkingBlock";
import { Skeleton, Button, CopyButton } from "@hexagen/ui";
import { ArrowLeft } from "lucide-react";
import { ProjectsShell } from "@/landing/ProjectsShell";
import type { StagedPhase } from "./staged-generation-types";
import {
  hasServerLLMAccessKey,
  isLocalLLMReady,
} from "../../app/lib/wire.client";
import { usePendingManifest } from "./store/usePendingManifest";
import { parseManifestToWizardData } from "@hexagen/wizard-orchestration";

type SpecPageState =
  | "UPLOAD"
  | "SPEC_REVIEW"
  | "DESCRIPTION_FALLBACK"
  | "CONVERTING_LOOSE_SPEC"
  | "GENERATING"
  | "PREVIEW";

interface SpecSummary {
  contextCount: number;
  aggregateCount: number;
  valueObjectCount: number;
  useCaseCount: number;
  mappingCount: number;
  eventBusSubscriptionCount: number;
}

function extractSpecSummary(parsed: Record<string, unknown>): SpecSummary {
  const contexts = (parsed.bounded_contexts ?? []) as Array<
    Record<string, unknown>
  >;
  const useCasesMap = (parsed.use_cases ?? {}) as Record<
    string,
    Array<Record<string, unknown>>
  >;

  return {
    contextCount: contexts.length,
    aggregateCount: contexts.reduce(
      (sum, ctx) =>
        sum +
        ((ctx.aggregates as Array<Record<string, unknown>>) ?? []).filter(
          (a) => {
            const agg = a as { root?: boolean };
            return agg.root !== false;
          },
        ).length,
      0,
    ),
    valueObjectCount: contexts.reduce(
      (sum, ctx) => sum + ((ctx.value_objects as Array<unknown>) ?? []).length,
      0,
    ),
    useCaseCount: Object.values(useCasesMap).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0,
    ),
    mappingCount: ((parsed.context_mappings as Array<unknown>) ?? []).length,
    eventBusSubscriptionCount: (
      (((parsed.event_bus as Record<string, unknown>) ?? {})
        .subscriptions as Array<unknown>) ?? []
    ).length,
  };
}

const SPEC_STAGE_LABELS: Partial<Record<StagedPhase, string>> = {
  "stage-0": "Parsing Configuration",
  "stage-1": "Building Domain Model",
  "stage-2": "Classifying Contexts",
  "stage-3": "Mapping Ports",
  "stage-4": "Assigning Adapters",
  "stage-5": "Assembling Manifest",
  "stage-6": "Validating",
};

export default function ImportProjectSpecPage() {
  const router = useRouter();
  const pendingManifest = usePendingManifest();
  const [pageState, setPageState] = useState<SpecPageState>("UPLOAD");
  const [previousState, setPreviousState] = useState<SpecPageState | null>(
    null,
  );
  const [specSummary, setSpecSummary] = useState<SpecSummary | null>(null);
  const [specContent, setSpecContent] = useState<string>("");
  const [generatedManifest, setGeneratedManifest] = useState<string | null>(
    null,
  );

  // Hook for spec path (structured config)
  const specGeneration = useStagedSpecGeneration();

  // Hook for description fallback path
  const manifestGeneration = useStagedManifestGeneration();

  // Hook for loose spec conversion
  const {
    convert,
    error: conversionError,
    reset: resetConversion,
  } = useLooseSpecConversion();

  useEffect(() => {
    const saved = sessionStorage.getItem("import_spec_content");
    if (saved && !specContent) {
      handleFileLoaded(saved);
    }
  }, []);

  const handleFileLoaded = (content: string) => {
    sessionStorage.setItem("import_spec_content", content);
    const mode: InputMode = detectInputMode(content);

    if (mode === "structured-config") {
      setSpecContent(content);
      setPageState("SPEC_REVIEW");
      try {
        const parsed = yaml.load(content) as Record<string, unknown>;
        setSpecSummary(extractSpecSummary(parsed));
      } catch {
        setSpecSummary(null);
      }
    } else if (mode === "semi-structured") {
      setSpecContent(content);
      setPageState("CONVERTING_LOOSE_SPEC");
      convert(content).then((result) => {
        if (result.convertedConfig) {
          try {
            const parsed = JSON.parse(result.convertedConfig);
            setSpecContent(result.convertedConfig);
            sessionStorage.setItem(
              "import_spec_content",
              result.convertedConfig,
            );
            setSpecSummary(extractSpecSummary(parsed));
            setPageState("SPEC_REVIEW");
          } catch {
            // Error handling JSON parse falls back to user seeing raw error or continuing.
          }
        }
      });
    } else {
      setSpecContent(content);
      setPageState("DESCRIPTION_FALLBACK");
    }
  };

  const handleMapPorts = useCallback(async () => {
    // Pre-generation guard
    const hasCloudKeys = hasServerLLMAccessKey();
    const hasLocalLLM = isLocalLLMReady();

    if (!hasCloudKeys && !hasLocalLLM) {
      router.push(
        "/projects/new/ai/models?returnUrl=/projects/new/import/spec",
      );
      return;
    }

    setPreviousState(pageState);
    setPageState("GENERATING");
    setGeneratedManifest(null);
    manifestGeneration.reset();

    const result = await specGeneration.generateFromSpec(specContent, {
      executionStrategy: "auto",
    });

    if (result?.generatedManifest) {
      setGeneratedManifest(result.generatedManifest);
      setPageState("PREVIEW");
    }
    // If result.phase === "failed", we intentionally stay on the GENERATING page
    // so the user can see the generationError message that is displayed there.
    else if (result?.phase === "failed") {
      const errorMsg = result.stepDetail || "";
      if (errorMsg.includes("No cloud LLM API keys configured")) {
        // Spec generation cannot run locally via WebLLM on the backend.
        // Fallback to the description mode which uses the local-capable useStagedManifestGeneration.
        setPageState("DESCRIPTION_FALLBACK");
      }
    }
  }, [specContent, specGeneration, manifestGeneration, pageState, router]);

  const handleContinue = useCallback(async () => {
    setPreviousState(pageState);
    setPageState("GENERATING");
    setGeneratedManifest(null);
    specGeneration.reset();

    const result = await manifestGeneration.generateManifest(specContent);

    if (result?.generatedManifest) {
      setGeneratedManifest(result.generatedManifest);
      setPageState("PREVIEW");
    } else if (result?.generationError) {
      if (result.generationError.includes("No cloud LLM API keys configured")) {
        router.push(
          "/projects/new/ai/models?returnUrl=/projects/new/import/spec",
        );
      } else {
        setPageState("DESCRIPTION_FALLBACK");
      }
    }
  }, [specContent, manifestGeneration, specGeneration, pageState, router]);

  const handleBack = () => {
    if (pageState === "SPEC_REVIEW" || pageState === "DESCRIPTION_FALLBACK") {
      setPageState("UPLOAD");
      setSpecSummary(null);
      setSpecContent("");
      sessionStorage.removeItem("import_spec_content");
    } else {
      router.push("/projects/new/import");
    }
  };

  const handleReset = () => {
    specGeneration.reset();
    manifestGeneration.reset();
    resetConversion();
    setGeneratedManifest(null);
    setPageState("UPLOAD");
    setSpecContent("");
    setSpecSummary(null);
    sessionStorage.removeItem("import_spec_content");
  };

  const handleAcceptAndContinue = useCallback(() => {
    if (!generatedManifest) return;
    try {
      const wizardData = parseManifestToWizardData(generatedManifest);
      const projectName =
        wizardData.governance?.workspaceName ||
        `Imported Project ${new Date().toLocaleTimeString()}`;
      pendingManifest.set(generatedManifest, wizardData, projectName);
      router.push("/projects/new/ai/accept");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to parse manifest for wizard:", errorMsg);
      setPageState("PREVIEW");
      // Don't route away—show error but let user inspect the YAML
    }
  }, [generatedManifest, pendingManifest, router]);

  const generationError =
    specGeneration.generationError || manifestGeneration.generationError;
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
      return (
        <>
          <Button
            variant="outline"
            onClick={() => {
              resetConversion();
              setPageState("UPLOAD");
              setSpecContent("");
              sessionStorage.removeItem("import_spec_content");
            }}
          >
            Cancel
          </Button>
          <span />
        </>
      );
    }
    if (pageState === "GENERATING") {
      return (
        <>
          <span />
          <Button
            variant="outline"
            onClick={() => {
              specGeneration.reset();
              manifestGeneration.reset();
              setPageState(previousState ?? "SPEC_REVIEW");
              setPreviousState(null);
            }}
          >
            {specGeneration.isGenerating || manifestGeneration.isGenerating
              ? "Cancel"
              : "Go Back"}
          </Button>
        </>
      );
    }
    if (pageState === "PREVIEW") {
      return (
        <>
          <Button variant="outline" onClick={handleReset}>
            Start Over
          </Button>
          <Button onClick={handleAcceptAndContinue}>Accept & Continue</Button>
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

  const isFullHeightState =
    pageState === "GENERATING" || pageState === "PREVIEW";

  return (
    <ProjectsShell title="Import Project Specification" footer={renderFooter()}>
      {isFullHeightState ? (
        <div className="h-full flex flex-col dot-grid bg-ambient p-4">
          {pageState === "GENERATING" && (
            <>
              <h2 className="text-xl font-semibold mb-3 shrink-0">
                Generating Manifest
              </h2>
              {generationError && (
                <div className="mb-3 p-4 bg-destructive/10 text-destructive rounded shrink-0">
                  Error: {generationError}
                </div>
              )}
              <div className="flex-1 min-h-0">
                <Suspense
                  fallback={
                    <div className="space-y-4">
                      <Skeleton className="h-64 w-full" />
                      <Skeleton className="h-32 w-48" />
                      <Skeleton className="h-96 w-full" />
                    </div>
                  }
                >
                  <ThinkingBlock
                    phase={phase}
                    stepDetail={stepDetail}
                    stageProgress={stageProgress}
                    stageLabels={SPEC_STAGE_LABELS}
                    verboseLog={verboseLog}
                  />
                </Suspense>
              </div>
            </>
          )}

          {pageState === "PREVIEW" && (
            <>
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h2 className="text-xl font-semibold">Manifest Preview</h2>
                {generatedManifest && (
                  <CopyButton
                    text={generatedManifest}
                    aria-label="Copy manifest YAML"
                  />
                )}
              </div>
              {generatedManifest && (
                <pre className="flex-1 min-h-0 p-4 bg-muted rounded overflow-auto text-sm font-mono">
                  {generatedManifest}
                </pre>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="h-full overflow-y-auto dot-grid bg-ambient">
          <div className="max-w-2xl mx-auto py-8 px-4">
            {pageState === "UPLOAD" && (
              <div>
                <h1 className="text-2xl font-bold mb-4">
                  Import Project Specification
                </h1>
                <p className="mb-4">
                  Upload a YAML or JSON spec file to generate a manifest.
                </p>
                <label
                  htmlFor="project-spec-file"
                  className="block mb-2 text-sm font-medium"
                >
                  Upload Project Specification
                </label>
                <input
                  id="project-spec-file"
                  type="file"
                  accept=".yaml,.yml,.json,.txt"
                  aria-describedby="file-help"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) =>
                      handleFileLoaded(ev.target?.result as string);
                    reader.readAsText(file);
                  }}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-accent file:text-accent-foreground hover:file:bg-accent/90"
                />
                <p
                  id="file-help"
                  className="text-sm text-muted-foreground mt-2"
                >
                  Upload a YAML or JSON spec file to generate a manifest.
                </p>
              </div>
            )}

            {pageState === "SPEC_REVIEW" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">Spec Review</h2>
                {specSummary && (
                  <div className="mb-4 space-y-2">
                    <p>
                      ✓ {specSummary.contextCount} bounded contexts detected
                    </p>
                    <p>✓ {specSummary.aggregateCount} aggregates</p>
                    <p>✓ {specSummary.valueObjectCount} value objects</p>
                    <p>✓ {specSummary.useCaseCount} use cases</p>
                    <p>✓ {specSummary.mappingCount} context mappings</p>
                    {specSummary.eventBusSubscriptionCount > 0 && (
                      <p>
                        ✓ Event bus: {specSummary.eventBusSubscriptionCount}{" "}
                        subscriptions
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-4">
                      AI will generate: hexagonal ports, adapter assignments,
                      manifest assembly, validation review
                    </p>
                    <p className="text-sm text-muted-foreground">
                      AI will skip: domain extraction (Stage 1), context
                      classification (Stage 2)
                    </p>
                  </div>
                )}
              </div>
            )}

            {pageState === "CONVERTING_LOOSE_SPEC" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">Converting...</h2>
                <div className="p-4 bg-muted rounded flex items-center gap-3">
                  <div className="animate-spin-border w-5 h-5 rounded-full border-2 border-primary border-t-transparent"></div>
                  <p>
                    Converting loose specification into structured
                    architecture...
                  </p>
                </div>
                {conversionError && (
                  <div className="mt-4 p-4 bg-destructive/10 text-destructive rounded">
                    Error: {conversionError}
                  </div>
                )}
              </div>
            )}

            {pageState === "DESCRIPTION_FALLBACK" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Description Detected
                </h2>
                <p className="mb-4">
                  Warning: This doesn't look like a structured spec. You can
                  continue with AI generation using this as a description.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </ProjectsShell>
  );
}
