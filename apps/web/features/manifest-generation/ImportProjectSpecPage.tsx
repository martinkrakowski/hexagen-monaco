"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import yaml from "js-yaml";
import { Button, FileDropZone } from "@hexagen/ui";
import { ArrowLeft, Check, Braces } from "lucide-react";
import { ProjectsShell } from "@/landing/ProjectsShell";
import { CreationStepIndicator } from "@/landing/components/CreationStepIndicator";
import { CREATION_STEPS } from "@/landing/domain/creation-path";
import { ManifestPreview } from "./ManifestPreview";
import { ThinkingBlock } from "./GenerateWithAi/ThinkingBlock";
import { useStagedSpecGeneration } from "./useStagedSpecGeneration";
import { useSavedProjects } from "../../app/hooks/useSavedProjects";
import type { ProjectConfig } from "@hexagen/project-configuration";

interface ParsedSpecConfig {
  intent?: string;
  explicitTechnologies?: string[];
  subdomains?: string[];
  classifiedContexts?: Array<{
    name: string;
    type: "core" | "supporting" | "generic" | "shared-kernel";
    reasoning: string;
  }>;
  [key: string]: unknown;
}

type SpecPagePhase = "upload" | "generating" | "preview" | "error";

export function ImportProjectSpecPage() {
  const router = useRouter();
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
  } = useStagedSpecGeneration();

  const [specContent, setSpecContent] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const pagePhase: SpecPagePhase = (() => {
    if (generationError) return "error";
    if (
      isGenerating ||
      (generationPhase !== "idle" && generationPhase !== "complete")
    )
      return "generating";
    if (generatedManifest) return "preview";
    return "upload";
  })();

  const parseSpecContent = useCallback((content: string): string | null => {
    try {
      const trimmed = content.trim();
      if (trimmed.startsWith("{")) {
        JSON.parse(trimmed);
      } else {
        yaml.load(trimmed);
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid config format";
    }
  }, []);

  const handleFileLoaded = useCallback(
    (content: string) => {
      setSpecContent(content);
      const error = parseSpecContent(content);
      setParseError(error);
    },
    [parseSpecContent],
  );

  const handleTextPaste = useCallback(
    (text: string) => {
      if (text.trim()) {
        setSpecContent(text);
        const error = parseSpecContent(text);
        setParseError(error);
      } else {
        setSpecContent(null);
        setParseError(null);
      }
    },
    [parseSpecContent],
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
      let parsed: ParsedSpecConfig | null = null;
      try {
        parsed = yaml.load(specContent || "") as ParsedSpecConfig;
        config = parsed as unknown as ProjectConfig;
      } catch {
        config = {} as ProjectConfig;
      }

      const projectName =
        parsed?.intent || `Spec Import ${new Date().toLocaleTimeString()}`;

      const projectId = saveProject(projectName, config, generatedManifest);
      router.push(`/wizard/1?project=${projectId}`);
    } catch (error) {
      console.error("Failed to save spec-imported project:", error);
      setIsSaving(false);
    }
  }, [generatedManifest, specContent, saveProject, router]);

  const handleCancel = useCallback(() => {
    if (pagePhase === "generating") {
      resetGeneration();
      setSpecContent(null);
      setParseError(null);
    } else if (specContent && pagePhase === "upload") {
      setSpecContent(null);
      setParseError(null);
    } else {
      router.push("/projects/new/import");
    }
  }, [pagePhase, specContent, resetGeneration, router]);

  const handleBackToUpload = useCallback(() => {
    resetGeneration();
    setSpecContent(null);
    setParseError(null);
  }, [resetGeneration]);

  const renderContent = () => {
    if (pagePhase === "generating") {
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

    if (pagePhase === "error") {
      return (
        <div className="p-4 sm:p-8">
          <div className="text-center space-y-4">
            <p className="text-sm font-medium text-destructive">
              Generation failed
            </p>
            <p className="text-xs text-muted-foreground">{generationError}</p>
          </div>
        </div>
      );
    }

    if (pagePhase === "preview") {
      return (
        <div className="p-4">
          <div className="bg-background border border-border rounded-lg overflow-hidden">
            <ManifestPreview
              manifestYaml={generatedManifest!}
              onApprove={handleAccept}
              onRegenerate={handleGenerate}
              onStartOver={handleBackToUpload}
              hideActions
              hideHeader
              embedded
            />
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
                onChange={(e) => handleTextPaste(e.target.value)}
                className="w-full h-48 sm:h-64 p-4 bg-background border border-border rounded-md font-mono text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFooter = () => {
    if (pagePhase === "generating") {
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

    if (pagePhase === "error") {
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

    if (pagePhase === "preview") {
      return (
        <>
          <Button
            variant="outline"
            onClick={handleBackToUpload}
            disabled={isSaving}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Upload
          </Button>
          <Button
            onClick={handleAccept}
            disabled={isSaving || !generatedManifest}
          >
            <Check className="h-4 w-4 mr-2" />
            {isSaving ? "Saving..." : "Import & Continue"}
          </Button>
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
