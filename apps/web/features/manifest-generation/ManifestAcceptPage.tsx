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
import { withCarriedName } from "./carriedName";
import { ManifestPreview } from "./ManifestPreview";
import type { ViewTab } from "./ManifestPreview";
import { useContextChatPanel } from "./store/useContextChatPanel";
import { useSavedProjects } from "../../app/hooks/useSavedProjects";
import { usePendingManifest } from "./store/usePendingManifest";
import { deriveInitialLayers, sessionMatchesSpec } from "./accept-save-layers";
import { clearGenesisFormValues } from "./genesis-workbench/genesisProjectSettingsStore";
import { ProjectsShellWithFreeTier } from "@/landing/ProjectsShellWithFreeTier";
import type { ProjectSpec } from "@hexagen/project-configuration";
import { parseYamlToViewData } from "@hexagen/manifest-generation";
import { computeHasBlockingFailures } from "./manifest-validation-display";

const TAB_CONFIG: { id: ViewTab; icon: typeof Network; label: string }[] = [
  { id: "context-map", icon: Network, label: "Context Map" },
  { id: "mermaid", icon: Component, label: "Mermaid" },
  { id: "validation", icon: ShieldCheck, label: "Validation" },
];

export function ManifestAcceptPage() {
  const router = useRouter();
  const pendingManifest = usePendingManifest();
  const {
    saveProject,
    updateLayer,
    isLoading: isLoadingProjects,
  } = useSavedProjects();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("context-map");
  const isNavigatingAway = useRef(false);

  // The AI drawer's store is a module singleton that outlives this page. Clear
  // it on mount and unmount so a remount (e.g. a different generated manifest)
  // can't reopen or auto-seed a context left over from a previous visit.
  useEffect(() => {
    const reset = useContextChatPanel.getState().reset;
    reset();
    return reset;
  }, []);

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

  // Same gate ManifestPreview applies to its own approve button: with a
  // server report the parser's connectivity heuristics are advisory and only
  // Invalid-YAML or a failed server report blocks; without one, any parser
  // FAIL blocks (see manifest-validation-display).
  const hasFailures = viewData
    ? computeHasBlockingFailures(viewData, pendingManifest.validationReport)
    : false;

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
      // Provenance capture: the import flow carries the user's ORIGINAL spec
      // text in the pending-manifest store (originSpecText — set only by the
      // flow that produced THIS manifest, unlike the durable sessionStorage
      // key, which a stale abandoned import could leak onto an unrelated
      // prompt-flow project). Persist it as an initial planning layer inside
      // the SAME save — a follow-up write could fail and leave the project
      // without its layer.
      const importedSpec = pendingManifest.originSpecText;
      // Live-session provenance (Plan phase finalize): when the spec the
      // import flow consumed is EXACTLY the distilled text the user confirmed,
      // deriveInitialLayers attaches the FULL brainstorm transcript instead of
      // a single "Imported project spec" turn (guard logic + shapes live in
      // accept-save-layers.ts). Both branches stamp the produced-manifest link.
      const session = pendingManifest.originSession;
      const initialLayers = deriveInitialLayers(importedSpec, session);

      // Await the (async IndexedDB) write before navigating so the wizard
      // reliably finds the project; navigating early lost the approved project.
      const projectId = await saveProject(
        pendingManifest.projectName,
        pendingManifest.formValues as ProjectSpec,
        pendingManifest.yaml,
        initialLayers,
      );

      if (!projectId) {
        setSaveError("Failed to create project. Please try again.");
        return;
      }

      // Stamp the SOURCE session layer (on the ORIGINATING project) done +
      // linked only now — after the hand-off actually produced a saved
      // manifest. Confirm-time stamping would mark the session done even when
      // the user cancels at the workspace guard dialog or the import flow
      // never completes. Best-effort: an unknown project/layer id (deleted
      // meanwhile) returns false without throwing, and a failed stamp must
      // not fail the accept-save itself.
      if (sessionMatchesSpec(session, importedSpec)) {
        await updateLayer(session.sourceProjectId, session.sourceLayerId, {
          status: "done",
          link: { type: "produced-manifest", at: Date.now() },
        });
      }

      isNavigatingAway.current = true;
      // A COMPLETED genesis save closes the Section A round-trip lifecycle
      // (Plan Workbench C2): drop the settings snapshot so a later fresh
      // genesis visit can't inherit this flow's edits. Gated on the GENESIS
      // originPath — an import-flow save has nothing to do with the genesis
      // snapshot — and deliberately NOT called on Back/Regenerate below:
      // surviving those abandoned-accept paths is the store's whole purpose.
      if (pendingManifest.originPath === "/projects/new/ai") {
        clearGenesisFormValues();
      }
      pendingManifest.clear();
      // Clear the import spec so the next new project starts from a blank canvas.
      sessionStorage.removeItem("import_spec_content");
      sessionStorage.removeItem("import_spec_original_content");
      router.push(`/wizard/1?project=${projectId}`);
    } catch {
      setSaveError("Unexpected error saving project. Please try again.");
    } finally {
      // Keep the "Saving…" screen up while navigating away on success;
      // otherwise release it so the user can retry.
      if (!isNavigatingAway.current) setIsSaving(false);
    }
  }, [
    canSave,
    canAccept,
    viewData,
    pendingManifest,
    saveProject,
    updateLayer,
    router,
  ]);

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
  // Don't move this read inside the callbacks (it would read the
  // already-cleared name).
  const carriedName = pendingManifest.projectName;

  // Back/Regenerate return to whichever generation flow produced the manifest
  // (prompt flow or spec import) — both push here, so a hardcoded
  // "/projects/new/ai" stranded import-flow users in the wrong flow. Captured
  // during render for the same reason as carriedName above. The fallback only
  // applies to a store populated before this field existed (impossible —
  // the store isn't persisted) or future setters that miss it.
  const originPath = pendingManifest.originPath || "/projects/new/ai";

  const handleBack = useCallback(() => {
    // Block the auto-redirect effect: clearing the store nulls `yaml`, which
    // would otherwise fire the parameterless `router.replace("/projects/new/ai")`
    // above and race away our `?name=` push.
    isNavigatingAway.current = true;
    pendingManifest.clear();
    router.push(withCarriedName(originPath, carriedName));
  }, [pendingManifest, router, carriedName, originPath]);

  const handleRegenerate = useCallback(() => {
    isNavigatingAway.current = true;
    pendingManifest.clear();
    // `generate=1` auto-starts the prompt flow; the import page ignores it
    // (the spec is restored from sessionStorage there and the user re-runs
    // generation explicitly).
    router.push(withCarriedName(`${originPath}?generate=1`, carriedName));
  }, [pendingManifest, router, carriedName, originPath]);

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
      {/* Part B-lite early-continue provenance: the user advanced with the
          Stage-5 manifest while the Stage-6 review was still streaming. The
          stream died with the generation page, so no server findings exist
          for this manifest — the approve gate falls back to the client-side
          parse checks (computeHasBlockingFailures with a null report). */}
      {pendingManifest.validationPending && (
        <div
          className="p-4 bg-warning/10 border border-warning/20 rounded-md text-sm text-warning"
          role="status"
        >
          Validation review was skipped — this manifest was accepted while the
          pipeline was still validating, so its findings are unavailable.
          Regenerate to review them.
        </div>
      )}
      {/* The AI governance chat is integrated into the preview frame as a
          collapsible third column (desktop) / slide-in overlay (mobile); it
          opens when a Context Map card is clicked via useContextChatPanel. */}
      <ManifestPreview
        manifestYaml={pendingManifest.yaml ?? ""}
        onApprove={handleApprove}
        onRegenerate={handleRegenerate}
        onStartOver={handleBack}
        onYamlChange={pendingManifest.updateYaml}
        hideActions
        hideHeader
        embedded
        showContextChat
        activeTab={activeTab}
        onTabChange={setActiveTab}
        // Server-report pass-through: gates the auto-fix loop and switches the
        // Validation tab to the pipeline's findings. updateYaml (wired above)
        // nulls it on any edit, re-arming the client fixer.
        validationReport={pendingManifest.validationReport}
      />
    </ProjectsShellWithFreeTier>
  );
}
