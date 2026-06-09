"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner } from "@hexagen/ui";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Network,
  Component,
  ShieldCheck,
} from "lucide-react";
import { ManifestPreview } from "./ManifestPreview";
import type { ViewTab } from "./ManifestPreview";
import { useSavedProjects } from "../../app/hooks/useSavedProjects";
import { usePendingManifest } from "./store/usePendingManifest";
import { ProjectsShellWithFreeTier } from "@/landing/ProjectsShellWithFreeTier";
import type { ProjectSpec } from "@hexagen/project-configuration";
import { parseYamlToViewData } from "@hexagen/manifest-generation";

const TAB_CONFIG: { id: ViewTab; icon: typeof Network; label: string }[] = [
  { id: "context-map", icon: Network, label: "Context Map" },
  { id: "mermaid", icon: Component, label: "Mermaid" },
  { id: "validation", icon: ShieldCheck, label: "Validation" },
];

export function ManifestAcceptPage() {
  const router = useRouter();
  const pendingManifest = usePendingManifest();
  const { saveProject, isLoading: isLoadingProjects } = useSavedProjects();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("context-map");
  const isNavigatingAway = useRef(false);

  useEffect(() => {
    if (isNavigatingAway.current) return;
    if (pendingManifest.yaml === null && !isSaving) {
      setRedirecting(true);
      router.replace("/projects/new/ai");
    }
  }, [pendingManifest.yaml, router, isSaving]);

  const viewData = useMemo(() => {
    if (!pendingManifest.yaml) return null;
    try {
      return parseYamlToViewData(pendingManifest.yaml);
    } catch {
      return null;
    }
  }, [pendingManifest.yaml]);

  const hasFailures =
    viewData?.validationItems.some((v) => v.status === "fail") ?? false;

  const canAccept =
    !!pendingManifest.yaml &&
    !!pendingManifest.projectName &&
    !!pendingManifest.formValues &&
    !hasFailures &&
    !isLoadingProjects;

  const canSave = !isSaving && !isLoadingProjects;

  // Core save logic extracted so every entry point (footer button OR any
  // ManifestPreview internal path) goes through the same guards.
  const executeSave = useCallback(async () => {
    if (!canSave || !canAccept || !viewData) return;
    if (
      !pendingManifest.yaml ||
      !pendingManifest.projectName ||
      !pendingManifest.formValues
    ) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      // Await the (async IndexedDB) write before navigating so the wizard
      // reliably finds the project; navigating early lost the approved project.
      const projectId = await saveProject(
        pendingManifest.projectName,
        pendingManifest.formValues as ProjectSpec,
        pendingManifest.yaml,
      );

      if (!projectId) {
        setSaveError("Failed to create project. Please try again.");
        return;
      }

      isNavigatingAway.current = true;
      pendingManifest.clear();
      // Clear the import spec so the next new project starts from a blank canvas.
      sessionStorage.removeItem("import_spec_content");
      router.push(`/wizard/1?project=${projectId}`);
    } catch {
      setSaveError("Unexpected error saving project. Please try again.");
    } finally {
      // Keep the "Saving…" screen up while navigating away on success;
      // otherwise release it so the user can retry.
      if (!isNavigatingAway.current) setIsSaving(false);
    }
  }, [canSave, canAccept, viewData, pendingManifest, saveProject, router]);

  // Wrapper accepted by ManifestPreview's onApprove (string) and the footer
  // button's onClick (MouseEvent). Both paths converge here and both are
  // guarded by executeSave — so ManifestPreview's internal rendering path
  // (embedded, non-embedded, or any future variant) cannot bypass the guards.
  const handleApprove = useCallback(
    (arg: string | React.MouseEvent | undefined) => {
      void arg;
      void executeSave();
    },
    [executeSave],
  );

  // Re-attach the project name to the URL so it survives the round-trip back to
  // the generation screen (the Project Name step ran before this page).
  // Computed during render and captured in the handler closures *before* they
  // call `pendingManifest.clear()` — so the cleared store can't blank it out.
  // Don't move this computation inside the callbacks (it would read the
  // already-cleared name).
  const nameQuery = pendingManifest.projectName
    ? `name=${encodeURIComponent(pendingManifest.projectName)}`
    : "";

  const handleBack = useCallback(() => {
    // Block the auto-redirect effect: clearing the store nulls `yaml`, which
    // would otherwise fire the parameterless `router.replace("/projects/new/ai")`
    // above and race away our `?name=` push.
    isNavigatingAway.current = true;
    pendingManifest.clear();
    router.push(`/projects/new/ai${nameQuery ? `?${nameQuery}` : ""}`);
  }, [pendingManifest, router, nameQuery]);

  const handleRegenerate = useCallback(() => {
    isNavigatingAway.current = true;
    pendingManifest.clear();
    router.push(
      `/projects/new/ai?generate=1${nameQuery ? `&${nameQuery}` : ""}`,
    );
  }, [pendingManifest, router, nameQuery]);

  const renderHeaderContent = () => {
    if (!viewData) {
      return (
        <span className="font-semibold text-sm truncate">
          Approve Generated Manifest
        </span>
      );
    }

    const scoreColor =
      viewData.overallScore >= 80
        ? "bg-success/10 text-success border-success/20"
        : viewData.overallScore >= 50
          ? "bg-warning/10 text-warning border-warning/20"
          : "bg-destructive/10 text-destructive border-destructive/20";

    return (
      <>
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm truncate">
            Approve Generated Manifest
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded font-mono border ${scoreColor}`}
          >
            {viewData.overallScore}% Score
          </span>
          <span className="text-xs text-muted-foreground font-mono hidden md:inline">
            {viewData.system} · {viewData.architecture} ·{" "}
            {viewData.contexts.length} contexts
          </span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto shrink-0">
          {TAB_CONFIG.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-label={label}
              className={`flex items-center px-2 py-1 rounded-md text-xs transition-colors shrink-0 ${
                activeTab === id
                  ? "bg-accent text-accent-foreground border border-accent"
                  : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"
              }`}
            >
              <Icon className="w-3 h-3 sm:mr-1" />{" "}
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </>
    );
  };

  if (redirecting) {
    return (
      <ProjectsShellWithFreeTier title="Approve Generated Manifest">
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-2">
            <h2 className="text-lg font-semibold text-foreground">
              Redirecting...
            </h2>
            <p className="text-sm text-muted-foreground">
              No manifest found. Returning to generation screen.
            </p>
          </div>
        </div>
      </ProjectsShellWithFreeTier>
    );
  }

  if (isSaving) {
    return (
      <ProjectsShellWithFreeTier title="Approve Generated Manifest">
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-2">
            <h2 className="text-lg font-semibold text-foreground">
              Saving Project...
            </h2>
            <p className="text-sm text-muted-foreground">
              Please wait while we save your project.
            </p>
            <div className="flex justify-center mt-4">
              <Spinner className="h-6 w-6" />
            </div>
          </div>
        </div>
      </ProjectsShellWithFreeTier>
    );
  }

  if (!pendingManifest.yaml) {
    return null;
  }

  const isFooterDisabled = !canSave || !canAccept || !viewData;

  return (
    <ProjectsShellWithFreeTier
      headerContent={renderHeaderContent()}
      footer={
        <>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={handleBack}
              disabled={isSaving}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button
              variant="secondary"
              onClick={handleRegenerate}
              disabled={isSaving}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Regenerate
            </Button>
          </div>
          <Button
            type="button"
            onClick={handleApprove}
            disabled={isFooterDisabled}
          >
            <ArrowRight className="w-4 h-4 ml-2" />
            Use This Manifest
          </Button>
        </>
      }
    >
      {saveError && (
        <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive">
          {saveError}
        </div>
      )}
      <ManifestPreview
        manifestYaml={pendingManifest.yaml ?? ""}
        onApprove={handleApprove}
        onRegenerate={handleRegenerate}
        onStartOver={handleBack}
        onYamlChange={pendingManifest.updateYaml}
        hideActions
        hideHeader
        embedded
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </ProjectsShellWithFreeTier>
  );
}
