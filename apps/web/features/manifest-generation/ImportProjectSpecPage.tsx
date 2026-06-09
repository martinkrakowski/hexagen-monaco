"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { InputMode } from "./GenerateWithAi/utils/detect-input-mode";
import { detectInputMode } from "./GenerateWithAi/utils/detect-input-mode";
import { logger } from "../../lib/structured-logger";
import yaml from "js-yaml";
import { useStagedSpecGeneration } from "./useStagedSpecGeneration";
import { useStagedManifestGeneration } from "./useStagedManifestGeneration";
import { useLooseSpecConversion } from "./useLooseSpecConversion";
import { Button } from "@hexagen/ui";
import { ArrowLeft } from "lucide-react";
import { ProjectsShellWithFreeTier } from "@/landing/ProjectsShellWithFreeTier";
import { useLLMReadiness } from "./hooks/useLLMReadiness";
import { usePendingManifest } from "./store/usePendingManifest";
import { parseManifestToWizardData } from "@hexagen/wizard-orchestration";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";
import { setManifestIdentity } from "./manifestIdentity";

import { SpecUploadStep } from "./import-project-spec/SpecUploadStep";
import { SpecReviewStep } from "./import-project-spec/SpecReviewStep";
import { SpecConvertingStep } from "./import-project-spec/SpecConvertingStep";
import { SpecDescriptionFallbackStep } from "./import-project-spec/SpecDescriptionFallbackStep";
import { ManifestGeneratingStep } from "./import-project-spec/ManifestGeneratingStep";
import { ManifestPreviewStep } from "./import-project-spec/ManifestPreviewStep";
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
  | "GENERATING"
  | "PREVIEW";

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
  const [cameFromConversion, setCameFromConversion] = useState(false);
  const [isJsonDisclosed, setIsJsonDisclosed] = useState(false);
  const [generatedManifest, setGeneratedManifest] = useState<string | null>(
    null,
  );
  const { needsSetup, isProbing } = useLLMReadiness();

  // Hook for spec path (structured config)
  const specGeneration = useStagedSpecGeneration();

  // Hook for description fallback path
  const manifestGeneration = useStagedManifestGeneration();

  // Hook for loose spec conversion
  const {
    convert,
    error: conversionError,
    progressMessage: conversionProgressMessage,
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
      } catch {
        // Hook returned configJson but it's not parseable JSON — surface as a
        // conversion failure so the user gets Retry / Continue options.
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
    if (needsSetup) return;

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
    } else if (result?.phase === "failed") {
      const errorMsg = result.stepDetail || "";
      if (errorMsg.includes("No cloud LLM API keys configured")) {
        // Spec generation cannot run locally via WebLLM on the backend.
        // Fallback to the description mode which uses the local-capable useStagedManifestGeneration.
        setPageState("DESCRIPTION_FALLBACK");
      }
      // Other failures: specGeneration.generationError is set by executeCloudGeneration,
      // so ManifestGeneratingStep will display the error. The "Go Back" button is shown
      // when isGenerating=false, so the user can recover.
    }
  }, [needsSetup, specContent, specGeneration, manifestGeneration, pageState]);

  const handleContinue = useCallback(async () => {
    if (needsSetup) return;

    setPreviousState(pageState);
    setPageState("GENERATING");
    setGeneratedManifest(null);
    specGeneration.reset();

    const result = await manifestGeneration.generateManifest(specContent);

    if (result?.generatedManifest) {
      setGeneratedManifest(result.generatedManifest);
      setPageState("PREVIEW");
    } else if (result?.generationError) {
      setPageState("DESCRIPTION_FALLBACK");
    }
  }, [needsSetup, specContent, manifestGeneration, specGeneration, pageState]);

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
      // The user-entered name (from the Project Name step) wins: it becomes the
      // saved-project name and seeds `governance.workspaceName` so the name is
      // factored into generated output. Fall back to the manifest-derived name
      // only if the step was bypassed (e.g. a direct visit to this page).
      const projectName =
        carriedName ||
        wizardData.governance?.workspaceName ||
        `Imported Project ${new Date().toLocaleTimeString()}`;
      // Keep the previewed/saved manifest string in sync with the carried name:
      // seed the form's workspaceName/namespacePrefix AND rewrite the manifest's
      // top-level system/scope so the Approve screen and saved manifestYaml
      // agree with formState (see manifestIdentity).
      let manifestYaml = generatedManifest;
      if (carriedName && wizardData.governance) {
        const slug = deriveWorkspaceName(carriedName).name;
        const scope = `@${slug}`;
        wizardData.governance.workspaceName = slug;
        wizardData.governance.namespacePrefix = scope;
        manifestYaml = setManifestIdentity(generatedManifest, {
          system: slug,
          scope,
        });
      }
      pendingManifest.set(manifestYaml, wizardData, projectName);
      router.push("/projects/new/ai/accept");
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error("Failed to parse manifest for wizard:", {
          error: errorMsg,
        });
      }
      setPageState("PREVIEW");
      // Don't route away—show error but let user inspect the YAML
    }
  }, [generatedManifest, pendingManifest, router, carriedName]);

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
    <ProjectsShellWithFreeTier
      headerContent={
        <span className="font-semibold text-sm truncate">
          Import Project Specification
        </span>
      }
      footer={renderFooter()}
    >
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
            {(pageState === "SPEC_REVIEW" ||
              pageState === "DESCRIPTION_FALLBACK") &&
              needsSetup &&
              !isProbing && (
                <div className="mb-6">
                  <ModelSetupPrompt
                    onSetupModel={() =>
                      router.push(
                        "/projects/new/ai/models?returnUrl=/projects/new/import/spec",
                      )
                    }
                  />
                </div>
              )}

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
              <SpecConvertingStep
                conversionError={conversionError}
                progressMessage={conversionProgressMessage}
              />
            )}

            {pageState === "DESCRIPTION_FALLBACK" && (
              <SpecDescriptionFallbackStep />
            )}
          </div>
        </div>
      )}
    </ProjectsShellWithFreeTier>
  );
}
