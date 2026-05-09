"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hexagen/ui";
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
import { ProjectsShell } from "@/landing/ProjectsShell";
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
  const { saveProject } = useSavedProjects();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("context-map");

  useEffect(() => {
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

  const handleAccept = useCallback(async () => {
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
      const projectId = saveProject(
        pendingManifest.projectName,
        pendingManifest.formValues as ProjectSpec,
        pendingManifest.yaml,
      );

      router.push(`/wizard/1?project=${projectId}`);
      pendingManifest.clear();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save project";
      setSaveError(message);
      setIsSaving(false);
    }
  }, [pendingManifest, saveProject, router]);

  const handleBack = useCallback(() => {
    pendingManifest.clear();
    router.push("/projects/new/ai");
  }, [pendingManifest, router]);

  const handleRegenerate = useCallback(() => {
    pendingManifest.clear();
    router.push("/projects/new/ai?generate=1");
  }, [pendingManifest, router]);

  const hasFailures =
    viewData?.validationItems.some((v) => v.status === "fail") ?? false;

  const canAccept =
    !!pendingManifest.yaml &&
    !!pendingManifest.projectName &&
    !!pendingManifest.formValues &&
    !hasFailures;

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
        <div className="flex items-center gap-1">
          {TAB_CONFIG.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center px-2.5 py-1 rounded-md text-xs transition-colors ${
                activeTab === id
                  ? "bg-accent text-accent-foreground border border-accent"
                  : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"
              }`}
            >
              <Icon className="w-3 h-3 mr-1" /> {label}
            </button>
          ))}
        </div>
      </>
    );
  };

  if (redirecting) {
    return (
      <ProjectsShell title="Approve Generated Manifest">
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
      </ProjectsShell>
    );
  }

  if (isSaving) {
    return (
      <ProjectsShell title="Approve Generated Manifest">
        <div className="flex items-center justify-center h-full">
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
      </ProjectsShell>
    );
  }

  if (!pendingManifest.yaml) {
    return null;
  }

  return (
    <ProjectsShell
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
            onClick={handleAccept}
            disabled={isSaving || !canAccept || !viewData}
          >
            {isSaving ? (
              <svg
                className="animate-spin h-4 w-4 ml-2"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <ArrowRight className="w-4 h-4 ml-2" />
            )}
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
        onApprove={handleAccept}
        onRegenerate={handleRegenerate}
        onStartOver={handleBack}
        onYamlChange={pendingManifest.updateYaml}
        hideActions
        hideHeader
        embedded
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </ProjectsShell>
  );
}
