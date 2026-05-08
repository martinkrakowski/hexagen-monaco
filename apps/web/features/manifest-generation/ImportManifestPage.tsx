"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FileDropZone } from "@hexagen/ui";
import { ArrowLeft, Check } from "lucide-react";
import { ManifestPreview } from "./ManifestPreview";
import { useManifestParser } from "./useManifestParser";
import { useSavedProjects } from "../../app/hooks/useSavedProjects";
import type { ProjectConfig } from "@hexagen/project-configuration";

/**
 * ImportManifestPage — Single-page manifest import flow.
 *
 * This page is rendered at `/projects/new/import` and allows users to:
 * 1. Upload manifest file (YAML/YML) via drag-drop or browse
 * 2. Paste manifest YAML directly in textarea
 * 3. Preview the parsed manifest
 * 4. Accept and save to wizard (parsed YAML → ProjectConfig → saveProject)
 *
 * Flow:
 * 1. File/text input → raw YAML string stored in state
 * 2. useManifestParser parses YAML → ProjectConfig (WizardData)
 * 3. Extract project name from parsed data.governance.workspaceName
 * 4. Accept: call saveProject(name, projectConfig, rawYaml) → navigate to wizard
 * 5. Cancel/Back: navigate to `/projects/new` or clear state
 *
 * Note: No pendingManifest store (unlike AI flow). Import is single-page, stateless.
 */
export function ImportManifestPage() {
  const router = useRouter();
  const { saveProject } = useSavedProjects();
  const {
    parseManifest,
    result: parsedData,
    error: parseError,
  } = useManifestParser();

  const [manifestYaml, setManifestYaml] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Handle raw YAML string from file upload
   */
  const handleFileLoaded = (content: string) => {
    setManifestYaml(content);
    // Parse immediately to show preview
    parseManifest(content);
  };

  /**
   * Handle pasted YAML from textarea
   */
  const handleTextPaste = (text: string) => {
    if (text.trim()) {
      setManifestYaml(text);
      parseManifest(text);
    } else {
      setManifestYaml(null);
    }
  };

  /**
   * Accept imported manifest and save as new project
   * Uses parsed ProjectConfig (from useManifestParser) + raw YAML
   */
  const handleAccept = async () => {
    if (!manifestYaml || !parsedData) return;

    setIsSaving(true);
    try {
      // Extract project name from parsed data; fallback to timestamp if not present
      const projectName =
        parsedData.governance?.workspaceName ||
        `Imported Project ${new Date().toLocaleTimeString()}`;

      // Save project with parsed form values and raw YAML
      const projectId = saveProject(
        projectName,
        parsedData as ProjectConfig,
        manifestYaml,
      );

      // Navigate to wizard with new project ID
      router.push(`/wizard/1?project=${projectId}`);
    } catch (error) {
      console.error("Failed to save imported project:", error);
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (manifestYaml) {
      setManifestYaml(null);
    } else {
      router.push("/projects/new");
    }
  };

  return (
    <div className="min-h-screen bg-background py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header section */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button
              onClick={handleCancel}
              className="p-1.5 hover:bg-card rounded-md transition-colors"
              title="Back to project creation"
            >
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </button>
            <h1 className="text-2xl font-bold text-foreground">
              Import Manifest
            </h1>
          </div>
          <p className="text-sm text-muted-foreground ml-11">
            Upload an existing{" "}
            <code className="text-xs bg-muted-foreground/10 px-1 py-0.5 rounded">
              manifest.yaml
            </code>{" "}
            file or paste YAML content directly to continue.
          </p>
        </div>

        {!manifestYaml ? (
          // Upload/Paste section (shown when no manifest loaded)
          <div className="bg-card border border-border rounded-lg p-8 space-y-6">
            {/* File upload zone (using FileDropZone from @hexagen/ui) */}
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

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-sm text-muted-foreground">
                Or paste below
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Text paste area */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Paste Manifest YAML
              </label>
              <textarea
                placeholder="Paste your manifest.yaml content here..."
                onChange={(e) => handleTextPaste(e.target.value)}
                className="w-full h-64 p-4 bg-background border border-border rounded-md font-mono text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
              />
            </div>

            {/* Cancel button */}
            <div className="flex justify-end pt-4 border-t border-border">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isSaving}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        ) : parseError ? (
          // Error state (parsing failed)
          <div className="bg-card border border-border rounded-lg p-8">
            <div className="text-center space-y-4">
              <p className="text-sm font-medium text-destructive">
                Failed to parse manifest:
              </p>
              <p className="text-xs text-muted-foreground">{parseError}</p>
              <div className="flex justify-center gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setManifestYaml(null)}
                  disabled={isSaving}
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Upload
                </Button>
              </div>
            </div>
          </div>
        ) : (
          // Preview section (shown after successful parse)
          <>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <ManifestPreview
                manifestYaml={manifestYaml}
                onApprove={handleAccept}
                onRegenerate={() => setManifestYaml(null)}
                onStartOver={() => setManifestYaml(null)}
              />
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between py-4 border-t border-border pt-6">
              <Button
                variant="outline"
                onClick={() => setManifestYaml(null)}
                disabled={isSaving}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Upload
              </Button>
              <Button
                onClick={handleAccept}
                disabled={isSaving || !parsedData}
                className="bg-gradient-to-br from-accent to-amber-600 text-black hover:shadow-lg hover:shadow-accent/30 transition-all"
              >
                <Check className="w-4 h-4 mr-2" />
                {isSaving ? "Saving..." : "Import & Continue"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
