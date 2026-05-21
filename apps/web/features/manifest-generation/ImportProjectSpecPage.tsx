"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { InputMode } from "./GenerateWithAi/utils/detect-input-mode";
import { detectInputMode } from "./GenerateWithAi/utils/detect-input-mode";
import yaml from "js-yaml";
import { useStagedSpecGeneration } from "./useStagedSpecGeneration";
import { useStagedManifestGeneration } from "./useStagedManifestGeneration";
import { useLooseSpecConversion } from "./useLooseSpecConversion";
import { Button } from "@hexagen/ui";
import { ArrowLeft } from "lucide-react";
import { ProjectsShell } from "@/landing/ProjectsShell";
import {
  hasServerLLMAccessKey,
  isLocalLLMReady,
} from "../../app/lib/wire.client";
import { usePendingManifest } from "./store/usePendingManifest";
import { parseManifestToWizardData } from "@hexagen/wizard-orchestration";

import { SpecUploadStep } from "./import-project-spec/SpecUploadStep";
import { SpecReviewStep } from "./import-project-spec/SpecReviewStep";
import { SpecConvertingStep } from "./import-project-spec/SpecConvertingStep";
import { SpecDescriptionFallbackStep } from "./import-project-spec/SpecDescriptionFallbackStep";
import { ManifestGeneratingStep } from "./import-project-spec/ManifestGeneratingStep";
import { ManifestPreviewStep } from "./import-project-spec/ManifestPreviewStep";
import {
  extractSpecSummary,
  type SpecSummary,
} from "./import-project-spec/utils";

type SpecPageState =
  | "UPLOAD"
  | "SPEC_REVIEW"
  | "DESCRIPTION_FALLBACK"
  | "CONVERTING_LOOSE_SPEC"
  | "GENERATING"
  | "PREVIEW";

export default function ImportProjectSpecPage() {
  const router = useRouter();
  const pendingManifest = usePendingManifest();
  const [pageState, setPageState] = useState<SpecPageState>("UPLOAD");
  const [previousState, setPreviousState] = useState<SpecPageState | null>(
    null,
  );
  const [specSummary, setSpecSummary] = useState<SpecSummary | null>(null);
  const [specContent, setSpecContent] = useState<string>("");
  const [cameFromConversion, setCameFromConversion] = useState(false);
  const [isJsonDisclosed, setIsJsonDisclosed] = useState(false);
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

  const runConversion = useCallback(
    async (rawContent: string) => {
      setCameFromConversion(true);
      setPageState("CONVERTING_LOOSE_SPEC");
      resetConversion();
      const result = await convert(rawContent);
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
      } catch (e) {
        // Hook returned configJson but it's not parseable JSON — surface as a
        // conversion failure so the user gets Retry / Continue options.
        console.error("Converted config failed JSON.parse", e);
        resetConversion();
        setPageState("DESCRIPTION_FALLBACK");
      }
    },
    [convert, resetConversion],
  );

  const handleFileLoaded = (content: string) => {
    sessionStorage.setItem("import_spec_content", content);
    const mode: InputMode = detectInputMode(content);

    if (mode === "structured-config") {
      setCameFromConversion(false);
      setSpecContent(content);
      setPageState("SPEC_REVIEW");
      try {
        // Support both single-document and multi-document YAML (`---`
        // separators between disjoint top-level sections).
        const docs = yaml.loadAll(content) as Array<Record<string, unknown>>;
        const merged: Record<string, unknown> = {};
        for (const doc of docs) {
          if (doc && typeof doc === "object" && !Array.isArray(doc)) {
            Object.assign(merged, doc);
          }
        }
        setSpecSummary(extractSpecSummary(merged));
      } catch {
        setSpecSummary(null);
      }
    } else if (mode === "semi-structured") {
      setSpecContent(content);
      void runConversion(content);
    } else {
      setCameFromConversion(false);
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
    setCameFromConversion(false);
    setIsJsonDisclosed(false);
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
              setCameFromConversion(false);
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
            <ManifestGeneratingStep
              generationError={generationError}
              phase={phase}
              stepDetail={stepDetail}
              stageProgress={stageProgress}
              verboseLog={verboseLog}
            />
          )}

          {pageState === "PREVIEW" && (
            <ManifestPreviewStep generatedManifest={generatedManifest} />
          )}
        </div>
      ) : (
        <div className="h-full overflow-y-auto dot-grid bg-ambient">
          <div className="max-w-2xl mx-auto py-8 px-4">
            {pageState === "UPLOAD" && (
              <SpecUploadStep onFileLoaded={handleFileLoaded} />
            )}

            {pageState === "SPEC_REVIEW" && (
              <SpecReviewStep
                specSummary={specSummary}
                specContent={specContent}
                cameFromConversion={cameFromConversion}
                isJsonDisclosed={isJsonDisclosed}
                onToggleJsonDisclosed={setIsJsonDisclosed}
              />
            )}

            {pageState === "CONVERTING_LOOSE_SPEC" && (
              <SpecConvertingStep conversionError={conversionError} />
            )}

            {pageState === "DESCRIPTION_FALLBACK" && (
              <SpecDescriptionFallbackStep />
            )}
          </div>
        </div>
      )}
    </ProjectsShell>
  );
}
