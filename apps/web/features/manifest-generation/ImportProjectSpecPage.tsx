"use client";

import { useState, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import type { InputMode } from "./GenerateWithAi/utils/detect-input-mode";
import { detectInputMode } from "./GenerateWithAi/utils/detect-input-mode";
import yaml from "js-yaml";
import { useStagedSpecGeneration } from "./useStagedSpecGeneration";
import { useStagedManifestGeneration } from "./useStagedManifestGeneration";
import { ThinkingBlock } from "./GenerateWithAi/ThinkingBlock";
import { Skeleton } from "@hexagen/ui";
import type { StagedPhase } from "./staged-generation-types";

type SpecPageState =
  | "UPLOAD"
  | "SPEC_REVIEW"
  | "DESCRIPTION_FALLBACK"
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

  const handleFileLoaded = (content: string) => {
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
    } else {
      setSpecContent(content);
      setPageState("DESCRIPTION_FALLBACK");
    }
  };

  const handleMapPorts = useCallback(async () => {
    setPreviousState(pageState);
    setPageState("GENERATING");
    setGeneratedManifest(null);

    const result = await specGeneration.generateFromSpec(specContent);

    if (result?.generatedManifest) {
      setGeneratedManifest(result.generatedManifest);
      setPageState("PREVIEW");
    } else if (result?.phase === "failed") {
      setPageState("SPEC_REVIEW");
    }
  }, [specContent, specGeneration, pageState]);

  const handleContinue = useCallback(async () => {
    setPreviousState(pageState);
    setPageState("GENERATING");
    setGeneratedManifest(null);

    await manifestGeneration.generateManifest(specContent);

    if (manifestGeneration.generatedManifest) {
      setGeneratedManifest(manifestGeneration.generatedManifest);
      setPageState("PREVIEW");
    } else if (manifestGeneration.generationError) {
      setPageState("DESCRIPTION_FALLBACK");
    }
  }, [specContent, manifestGeneration, pageState]);

  const handleBack = () => {
    if (pageState === "SPEC_REVIEW" || pageState === "DESCRIPTION_FALLBACK") {
      setPageState("UPLOAD");
      setSpecSummary(null);
      setSpecContent("");
    } else {
      router.push("/projects/new/import");
    }
  };

  const handleReset = () => {
    specGeneration.reset();
    manifestGeneration.reset();
    setGeneratedManifest(null);
    setPageState("UPLOAD");
    setSpecContent("");
    setSpecSummary(null);
  };

  const generationError =
    specGeneration.generationError || manifestGeneration.generationError;
  const phase =
    specGeneration.phase !== "idle"
      ? specGeneration.phase
      : manifestGeneration.phase;
  const stepDetail = specGeneration.stepDetail || manifestGeneration.stepDetail;
  const stageProgress =
    specGeneration.stageProgress || manifestGeneration.stageProgress;

  return (
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
            accept=".yaml,.yml,.json"
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
          <p id="file-help" className="text-sm text-muted-foreground mt-2">
            Upload a YAML or JSON spec file to generate a manifest.
          </p>
        </div>
      )}

      {pageState === "SPEC_REVIEW" && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Spec Review</h2>
          {specSummary && (
            <div className="mb-4 space-y-2">
              <p>✓ {specSummary.contextCount} bounded contexts detected</p>
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
                AI will generate: hexagonal ports, adapter assignments, manifest
                assembly, validation review
              </p>
              <p className="text-sm text-muted-foreground">
                AI will skip: domain extraction (Stage 1), context
                classification (Stage 2)
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleMapPorts}
              className="px-4 py-2 bg-accent text-accent-foreground rounded hover:bg-accent/90"
            >
              Map Ports & Adapters
            </button>
            <button
              onClick={handleBack}
              className="px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {pageState === "DESCRIPTION_FALLBACK" && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Description Detected</h2>
          <p className="mb-4">
            Warning: This doesn't look like a structured spec. You can continue
            with AI generation using this as a description.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/projects/new/ai")}
              className="px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded"
            >
              Generate with AI instead
            </button>
            <button
              onClick={handleContinue}
              className="px-4 py-2 bg-accent text-accent-foreground rounded hover:bg-accent/90"
            >
              Continue anyway
            </button>
            <button
              onClick={handleBack}
              className="px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {pageState === "GENERATING" && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Generating Manifest</h2>
          {generationError && (
            <div className="mb-4 p-4 bg-destructive/10 text-destructive rounded">
              Error: {generationError}
            </div>
          )}
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
            />
          </Suspense>
          {(specGeneration.isGenerating || manifestGeneration.isGenerating) && (
            <button
              onClick={() => {
                specGeneration.reset();
                manifestGeneration.reset();
                setPageState(previousState ?? "SPEC_REVIEW");
                setPreviousState(null);
              }}
              className="mt-4 px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {pageState === "PREVIEW" && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Manifest Preview</h2>
          {generatedManifest && (
            <pre className="p-4 bg-muted rounded overflow-auto max-h-96 text-sm">
              {generatedManifest}
            </pre>
          )}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => {
                // Navigate to accept page or save
                router.push("/projects/new");
              }}
              className="px-4 py-2 bg-accent text-accent-foreground rounded hover:bg-accent/90"
            >
              Accept & Continue
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded"
            >
              Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
