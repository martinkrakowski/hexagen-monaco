"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, FileDropZone, Textarea } from "@hexagen/ui";
import { ArrowLeft, Check } from "lucide-react";
import { ManifestPreview } from "./ManifestPreview";
import { useManifestParser } from "./useManifestParser";
import { useSavedProjects } from "../../app/hooks/useSavedProjects";
import { ProjectsShellWithFreeTier } from "@/landing/ProjectsShellWithFreeTier";
import { logger } from "../../lib/structured-logger";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";
import type { ProjectConfig } from "@hexagen/project-configuration";

interface ImportManifestPageProps {
  readonly router?: { push: (url: string) => void };
  /**
   * Project name from the shared Project Name step. Injectable for tests; in the
   * app it is read from the `?name=` query when not provided.
   */
  readonly projectName?: string;
}

export function ImportManifestPage({
  router: injectedRouter,
  projectName: injectedName,
}: ImportManifestPageProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  const searchParams = useSearchParams();
  const carriedName =
    injectedName ?? searchParams.get("name")?.trim() ?? undefined;
  const { saveProject } = useSavedProjects();
  const {
    parseManifest,
    result: parsedData,
    error: parseError,
  } = useManifestParser();

  const [manifestYaml, setManifestYaml] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleFileLoaded = (content: string) => {
    setManifestYaml(content);
    parseManifest(content);
  };

  const handleTextPaste = (text: string) => {
    if (text.trim()) {
      setManifestYaml(text);
      parseManifest(text);
    } else {
      setManifestYaml(null);
    }
  };

  const handleAccept = async () => {
    if (!manifestYaml || !parsedData) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      // The user-entered name (from the Project Name step) wins: it becomes the
      // saved-project name and seeds `governance.workspaceName` so the name is
      // factored into generated output. Fall back to the manifest's own name
      // only if the step was bypassed (e.g. a direct visit to this page).
      const projectName =
        carriedName ||
        parsedData.governance?.workspaceName ||
        `Imported Project ${new Date().toLocaleTimeString()}`;

      // Clone before overriding: `parsedData` is `useManifestParser` state, so
      // mutating it in place would violate React's immutability contract (the
      // mutated object would leak into later renders if the save fails).
      const baseConfig = parsedData as ProjectConfig;
      const config: ProjectConfig =
        carriedName && baseConfig.governance
          ? {
              ...baseConfig,
              governance: {
                ...baseConfig.governance,
                workspaceName: deriveWorkspaceName(carriedName).name,
              },
            }
          : baseConfig;

      const projectId = await saveProject(projectName, config, manifestYaml);

      if (!projectId) {
        logger.error("Failed to save imported project: persistence failed");
        setSaveError(
          "Couldn't save the project — check your browser storage permissions or available space and try again.",
        );
        setIsSaving(false);
        return;
      }

      router.push(`/wizard/1?project=${projectId}`);
    } catch (error) {
      logger.error("Failed to save imported project", {
        error: error instanceof Error ? error.message : String(error),
      });
      setSaveError("Unexpected error saving the project. Please try again.");
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (manifestYaml) {
      setManifestYaml(null);
    } else {
      router.push("/projects/new/import");
    }
  };

  const renderContent = () => {
    if (!manifestYaml) {
      return (
        <div className="p-4 sm:p-8 space-y-6">
          <FileDropZone
            onFileLoaded={handleFileLoaded}
            accept=".yaml,.yml"
            validateFile={(file) => {
              if (!file.name.match(/\.(ya?ml)$/i)) {
                return "Please select a .yaml or .yml file";
              }
              return null;
            }}
            label="Upload manifest YAML file — click or drop to browse"
            hint={
              <>
                Drop a{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  manifest.yaml
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
              Paste Manifest YAML
            </label>
            <Textarea
              placeholder="Paste your manifest.yaml content here..."
              onChange={(e) => handleTextPaste(e.target.value)}
              className="h-48 sm:h-64 font-mono resize-none"
            />
          </div>
        </div>
      );
    }

    if (parseError) {
      return (
        <div className="p-4 sm:p-8">
          <div className="text-center space-y-4">
            <p className="text-sm font-medium text-destructive">
              Failed to parse manifest:
            </p>
            <p className="text-xs text-muted-foreground">{parseError}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="p-4">
        <div className="bg-background border border-border rounded-lg overflow-hidden">
          <ManifestPreview
            manifestYaml={manifestYaml}
            onApprove={handleAccept}
            onRegenerate={() => setManifestYaml(null)}
            onStartOver={() => setManifestYaml(null)}
            hideActions
            hideHeader
            embedded
          />
        </div>
      </div>
    );
  };

  return (
    <ProjectsShellWithFreeTier
      title="Import Manifest"
      footer={
        <>
          {!manifestYaml ? (
            <>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isSaving}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <span />
            </>
          ) : parseError ? (
            <>
              <Button
                variant="outline"
                onClick={() => setManifestYaml(null)}
                disabled={isSaving}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Upload
              </Button>
              <span />
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setManifestYaml(null)}
                disabled={isSaving}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Upload
              </Button>
              <Button onClick={handleAccept} disabled={isSaving || !parsedData}>
                <Check className="w-4 h-4 mr-2" />
                {isSaving ? "Saving..." : "Import & Continue"}
              </Button>
            </>
          )}
        </>
      }
    >
      {saveError && (
        <div
          role="alert"
          className="m-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {saveError}
        </div>
      )}
      {renderContent()}
    </ProjectsShellWithFreeTier>
  );
}
