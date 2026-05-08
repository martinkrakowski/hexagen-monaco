"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hexagen/ui";
import { ArrowLeft, Check, ArrowRight } from "lucide-react";
import { ManifestPreview } from "./ManifestPreview";
import { useSavedProjects } from "../../app/hooks/useSavedProjects";
import { usePendingManifest } from "./store/usePendingManifest";
import type { ProjectSpec } from "@hexagen/project-configuration";

/**
 * ManifestAcceptPage — Extracted review/accept step from the creation flow.
 *
 * This page is rendered at `/projects/new/ai/accept` after manifest generation.
 * It allows users to review the generated YAML and accept it to proceed to the wizard.
 *
 * Flow:
 * 1. On mount, check if pending manifest exists in store
 * 2. If missing, redirect to `/projects/new/ai` (enforce happy path)
 * 3. Render manifest preview with review UI
 * 4. Accept button: call saveProject(), clear store, navigate to `/wizard/1?project={id}`
 * 5. Back button: clear store, navigate to `/projects/new/ai`
 */
export function ManifestAcceptPage() {
  const router = useRouter();
  const pendingManifest = usePendingManifest();
  const { saveProject } = useSavedProjects();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // Enforce happy path: redirect if no pending manifest
  useEffect(() => {
    if (pendingManifest.yaml === null && !isSaving) {
      setRedirecting(true);
      router.replace("/projects/new/ai");
    }
  }, [pendingManifest.yaml, router, isSaving]);

  const handleAccept = async (yaml: string) => {
    if (!pendingManifest.projectName || !pendingManifest.formValues) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const projectId = saveProject(
        pendingManifest.projectName,
        pendingManifest.formValues as ProjectSpec,
        yaml,
      );

      router.push(`/wizard/1?project=${projectId}`);

      pendingManifest.clear();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save project";
      setSaveError(message);
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    // Clear the store
    pendingManifest.clear();
    // Navigate back to the AI generation screen
    router.push("/projects/new/ai");
  };

  // Show loading state while redirecting
  if (redirecting) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            Redirecting...
          </h2>
          <p className="text-sm text-muted-foreground">
            No manifest found. Returning to generation screen.
          </p>
        </div>
      </div>
    );
  }

  // Show loading state while saving
  if (isSaving) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            Saving Project...
          </h2>
          <p className="text-sm text-muted-foreground">
            Please wait while we save your project.
          </p>
          <div className="flex justify-center mt-4">
            <span className="animate-spin text-2xl">⏳</span>
          </div>
        </div>
      </div>
    );
  }

  // Render the manifest preview with review UI
  if (pendingManifest.yaml) {
    return (
      <div className="min-h-screen bg-background py-6 px-4">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header section */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button
                onClick={handleBack}
                className="p-1.5 hover:bg-card rounded-md transition-colors"
                title="Back to generation"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </button>
              <h1 className="text-2xl font-bold text-foreground">
                Review & Accept Manifest
              </h1>
            </div>
            <p className="text-sm text-muted-foreground ml-11">
              Review your generated architecture manifest and project details
              below. Click "Accept & Continue" to proceed to the wizard.
            </p>
          </div>

          {saveError && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive">
              {saveError}
            </div>
          )}

          {/* Form values display section */}
          <div className="bg-card border border-border rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              Project Details
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Project Name
                </label>
                <p className="text-base text-foreground mt-1 p-2 bg-background rounded border border-border">
                  {pendingManifest.projectName || "—"}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Bounded Contexts
                </label>
                <p className="text-base text-foreground mt-1 p-2 bg-background rounded border border-border">
                  {pendingManifest.formValues?.boundedContexts?.length || 0}
                </p>
              </div>
            </div>
          </div>

          {/* Manifest preview section */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <ManifestPreview
              manifestYaml={pendingManifest.yaml}
              onApprove={handleAccept}
              onRegenerate={handleBack}
              onStartOver={handleBack}
              hideActions
            />
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between py-4 border-t border-border pt-6">
            <Button variant="outline" onClick={handleBack} disabled={isSaving}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Generation
            </Button>
            <Button
              onClick={() => handleAccept(pendingManifest.yaml!)}
              disabled={isSaving}
              className="bg-gradient-to-br from-accent to-amber-600 text-black hover:shadow-lg hover:shadow-accent/30 transition-all"
            >
              <Check className="w-4 h-4 mr-2" />
              Accept & Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
