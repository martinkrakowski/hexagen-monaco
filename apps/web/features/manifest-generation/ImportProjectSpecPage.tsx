"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import yaml from "js-yaml";
import { Button, FileDropZone } from "@hexagen/ui";
import { ArrowLeft, Check, Braces } from "lucide-react";
import { ProjectsShell } from "@/landing/ProjectsShell";
import { CreationStepIndicator } from "@/landing/components/CreationStepIndicator";
import {
  CREATION_STEPS,
  detectInputMode,
} from "@/landing/domain/creation-path";
import { ThinkingBlock } from "./GenerateWithAi/ThinkingBlock";
import { useStagedSpecGeneration } from "./useStagedSpecGeneration";
import { useSavedProjects } from "../../app/hooks/useSavedProjects";
import { logger } from "../../lib/structured-logger";
import type { ProjectConfig } from "@hexagen/project-configuration";
import type { AssembledManifest } from "@hexagen/shared";
import {
  extractSpecSummary,
  type SpecSummary,
} from "./utils/extract-spec-summary";

type Phase =
  | "upload"
  | "spec-review"
  | "description-fallback"
  | "generating"
  | "preview"
  | "proposing"
  | "pr-created"
  | "error";

interface ImportProjectSpecPageProps {
  readonly router?: { push: (url: string) => void };
}

export function ImportProjectSpecPage({
  router: injectedRouter,
}: ImportProjectSpecPageProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const { saveProject } = useSavedProjects();
  const {
    generateFromSpec,
    isGenerating,
    generationError,
    generatedManifest,
    phase: generationPhase,
    stepDetail,
    stageProgress,
    reset: resetGeneration,
    proposePR,
    isProposing,
    prMetadata,
  } = useStagedSpecGeneration();

  const [specContent, setSpecContent] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [specSummary, setSpecSummary] = useState<SpecSummary | null>(null);
  const [phase, setPhase] = useState<Phase>("upload");

  useEffect(() => {
    if (phase === "proposing" || phase === "pr-created") return;
    if (generationError) setPhase("error");
    else if (
      isGenerating ||
      (generationPhase !== "idle" && generationPhase !== "complete")
    )
      setPhase("generating");
    else if (generatedManifest) setPhase("preview");
  }, [
    generationError,
    isGenerating,
    generationPhase,
    generatedManifest,
    phase,
  ]);

  const handleContentReceived = useCallback(
    (content: string, filename?: string) => {
      setSpecContent(content);
      setParseError(null);
      const mode = detectInputMode(content, filename);
      if (mode === "structured-config") {
        try {
          const trimmed = content.trim();
          const parsed = trimmed.startsWith("{")
            ? JSON.parse(trimmed)
            : yaml.load(trimmed);
          setSpecSummary(
            extractSpecSummary(
              parsed as Parameters<typeof extractSpecSummary>[0],
            ),
          );
          setPhase("spec-review");
        } catch {
          setPhase("description-fallback");
        }
      } else {
        setPhase("description-fallback");
      }
    },
    [],
  );

  const handleFileLoaded = useCallback(
    (content: string, filename?: string) => {
      handleContentReceived(content, filename);
    },
    [handleContentReceived],
  );

  const handleGenerate = useCallback(async () => {
    if (!specContent) return;
    setParseError(null);
    await generateFromSpec(specContent);
  }, [specContent, generateFromSpec]);

  const handleAccept = useCallback(async () => {
    if (!generatedManifest) return;
    setIsSaving(true);
    try {
      let config: ProjectConfig;
      let parsed: Record<string, unknown> | null = null;
      try {
        const content = specContent || "";
        const trimmed = content.trim();
        if (trimmed.startsWith("{")) {
          JSON.parse(trimmed);
        } else {
          yaml.load(trimmed);
        }
        parsed = yaml.load(trimmed) as Record<string, unknown>;
        config = parsed as unknown as ProjectConfig;
      } catch (e) {
        const errorMsg =
          e instanceof Error ? e.message : "Invalid config format";
        setParseError(`Failed to parse spec: ${errorMsg}`);
        setIsSaving(false);
        return;
      }

      const projectName =
        typeof parsed?.intent === "string" && parsed.intent.trim().length > 0
          ? parsed.intent.trim()
          : `Spec Import ${new Date().toLocaleTimeString()}`;

      const projectId = saveProject(projectName, config, generatedManifest);
      await router.push(`/wizard/1?project=${projectId}`);
      setIsSaving(false);
    } catch (error) {
      logger.error(
        `Failed to save spec-imported project: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setParseError(
        `Failed to save project: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setIsSaving(false);
    }
  }, [generatedManifest, specContent, saveProject, router, setParseError]);

  const handleCancel = useCallback(() => {
    if (phase === "generating") {
      resetGeneration();
      setSpecContent(null);
      setParseError(null);
    } else if (specContent && phase === "upload") {
      setSpecContent(null);
      setParseError(null);
    } else {
      router.push("/projects/new/import");
    }
  }, [phase, specContent, resetGeneration, router]);

  const handleBackToUpload = useCallback(() => {
    resetGeneration();
    setSpecContent(null);
    setParseError(null);
    setPhase("upload");
  }, [resetGeneration]);

  const handleProposePR = async () => {
    if (!generatedManifest) return;

    const result = await proposePR(
      JSON.parse(generatedManifest) as AssembledManifest,
      "Import structured config",
    );

    if (result.ok) {
      setPhase("pr-created");
    } else {
      setPhase("preview");
    }
  };

  const renderContent = () => {
    if (phase === "generating") {
      return (
        <div className="flex items-center justify-center min-h-full py-12">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 w-full">
            <CreationStepIndicator currentStep={3} steps={CREATION_STEPS} />
            <div className="mt-8">
              <ThinkingBlock
                phase={generationPhase}
                stepDetail={stepDetail}
                stageProgress={stageProgress}
              />
            </div>
          </div>
        </div>
      );
    }

    if (phase === "proposing") {
      return (
        <div className="flex items-center justify-center min-h-full py-12">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 w-full text-center space-y-4">
            <CreationStepIndicator currentStep={4} steps={CREATION_STEPS} />
            <p className="text-sm text-muted-foreground">
              Creating pull request...
            </p>
          </div>
        </div>
      );
    }

    if (phase === "pr-created" && prMetadata) {
      return (
        <div className="flex items-center justify-center min-h-full py-12">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 w-full text-center space-y-4">
            <CreationStepIndicator currentStep={5} steps={CREATION_STEPS} />
            <div className="text-green-600">
              <Check className="h-12 w-12 mx-auto" />
            </div>
            <h3 className="text-lg font-semibold">Pull Request Created!</h3>
            <p className="text-muted-foreground">
              Your manifest changes have been proposed in PR #
              {prMetadata.prNumber}
            </p>
            <a
              href={prMetadata.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              View Pull Request →
            </a>
          </div>
        </div>
      );
    }

    if (phase === "spec-review") {
      return (
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 w-full">
            <CreationStepIndicator currentStep={2} steps={CREATION_STEPS} />
            <div className="mt-8 space-y-6">
              <div className="p-4 rounded-lg border border-success/30 bg-success/5">
                <p className="text-sm font-medium text-foreground">
                  Structured Config Detected
                </p>
                {specSummary && (
                  <div className="mt-2 text-xs text-muted-foreground space-y-1">
                    <p>{specSummary.contextCount} bounded contexts</p>
                    <p>{specSummary.aggregateCount} aggregates</p>
                    <p>{specSummary.valueObjectCount} value objects</p>
                    <p>{specSummary.useCaseCount} use cases</p>
                    <p>{specSummary.mappingCount} context mappings</p>
                    <p>
                      {specSummary.eventBusSubscriptionCount} event bus
                      subscriptions
                    </p>
                  </div>
                )}
              </div>
              <div className="p-4 rounded-lg border border-info/30 bg-info/5 text-sm text-foreground space-y-2">
                <p>
                  <Check className="h-4 w-4 inline mr-2 text-success" /> AI will
                  generate: ports, adapters, manifest assembly, validation
                </p>
                <p>
                  <Check className="h-4 w-4 inline mr-2 text-success" /> AI will
                  skip: domain derivation (Stages 0–2), context classification
                </p>
              </div>
              <Button
                onClick={() => {
                  setPhase("generating");
                  generateFromSpec(specContent!);
                }}
              >
                Map Ports & Adapters
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (phase === "description-fallback") {
      return (
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 w-full">
            <CreationStepIndicator currentStep={2} steps={CREATION_STEPS} />
            <div className="mt-8 space-y-6">
              <div className="p-4 rounded-lg border border-warning/30 bg-warning/5">
                <p className="text-sm font-medium text-foreground">
                  This content doesn't look like a structured spec.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() =>
                    router.push(
                      `/projects/new/ai?prefill=${encodeURIComponent(specContent || "")}`,
                    )
                  }
                >
                  Generate with AI instead
                </Button>
                <Button
                  onClick={() => {
                    setPhase("generating");
                    generateFromSpec(specContent!);
                  }}
                >
                  Continue anyway
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (specContent && parseError) {
      return (
        <div className="p-4 sm:p-8">
          <div className="text-center space-y-4">
            <p className="text-sm font-medium text-destructive">
              Failed to parse config:
            </p>
            <p className="text-xs text-muted-foreground">{parseError}</p>
          </div>
        </div>
      );
    }

    if (specContent) {
      return (
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 w-full">
            <CreationStepIndicator currentStep={2} steps={CREATION_STEPS} />
            <div className="mt-8 flex items-center gap-3 p-4 rounded-lg border border-info/30 bg-info/5">
              <Braces className="h-5 w-5 text-info shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Config loaded
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Click Generate to map ports, assign adapters, and assemble
                  your manifest.
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 w-full">
          <CreationStepIndicator currentStep={2} steps={CREATION_STEPS} />
          <div className="mt-8 space-y-6">
            <FileDropZone
              onFileLoaded={handleFileLoaded}
              accept=".yaml,.yml,.json"
              validateFile={(file) => {
                if (!file.name.match(/\.(ya?ml|json)$/i)) {
                  return "Please select a .yaml, .yml, or .json file";
                }
                return null;
              }}
              label="Upload structured config — click or drop to browse"
              hint={
                <>
                  Drop a{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    config.yaml
                  </code>{" "}
                  or{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    config.json
                  </code>{" "}
                  file here
                </>
              }
            />

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-sm text-muted-foreground">
                Or paste below
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Paste Structured Config
              </label>
              <textarea
                placeholder="Paste your structured config (YAML or JSON) here..."
                onChange={(e) => handleContentReceived(e.target.value)}
                className="w-full h-48 sm:h-64 p-4 bg-background border border-border rounded-md font-mono text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFooter = () => {
    if (phase === "spec-review" || phase === "description-fallback") {
      return (
        <>
          <Button
            variant="outline"
            onClick={() => router.push("/projects/new/import")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <span />
        </>
      );
    }

    if (phase === "generating") {
      return (
        <>
          <Button variant="outline" onClick={handleCancel}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <span />
        </>
      );
    }

    if (phase === "error") {
      return (
        <>
          <Button variant="outline" onClick={handleBackToUpload}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Upload
          </Button>
          <span />
        </>
      );
    }

    if (phase === "preview") {
      return (
        <>
          <Button
            variant="outline"
            onClick={handleBackToUpload}
            disabled={isSaving || isProposing}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Upload
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPhase("proposing");
                handleProposePR();
              }}
              disabled={isSaving || isProposing || !generatedManifest}
            >
              {isProposing ? "Creating PR..." : "Create Pull Request"}
            </Button>
            <Button
              onClick={handleAccept}
              disabled={isSaving || isProposing || !generatedManifest}
            >
              <Check className="h-4 w-4 mr-2" />
              {isSaving ? "Saving..." : "Import & Continue"}
            </Button>
          </div>
        </>
      );
    }

    if (specContent && !parseError) {
      return (
        <>
          <Button variant="outline" onClick={handleCancel}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={handleGenerate} disabled={isGenerating}>
            Generate Manifest
          </Button>
        </>
      );
    }

    if (specContent && parseError) {
      return (
        <>
          <Button
            variant="outline"
            onClick={() => {
              setSpecContent(null);
              setParseError(null);
            }}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Upload
          </Button>
          <span />
        </>
      );
    }

    return (
      <>
        <Button variant="outline" onClick={handleCancel}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <span />
      </>
    );
  };

  return (
    <ProjectsShell title="Import Structured Config" footer={renderFooter()}>
      <div className="h-full overflow-y-auto">{renderContent()}</div>
    </ProjectsShell>
  );
}
