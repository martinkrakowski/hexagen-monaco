"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GenerateWithAi } from "./GenerateWithAi";
import { usePendingManifest } from "./store/usePendingManifest";
import { parseManifestToWizardData } from "@hexagen/wizard-orchestration";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";
import { setManifestIdentity } from "./manifestIdentity";
import { ProjectsShellWithFreeTier } from "@/landing/ProjectsShellWithFreeTier";
// PlanWorkbench is the shared PRESENTATIONAL two-pane shell (plan §3.1): it
// reads no app context — this host fills every slot with genesis-owned data,
// so the alias cross-slice import carries no workspace-shell coupling.
import { PlanWorkbench } from "@/workspace-shell/plan-phase/PlanWorkbench";
import { GenesisProjectSettingsSection } from "./genesis-workbench/GenesisProjectSettingsSection";
import { GenesisSourcesSection } from "./genesis-workbench/GenesisSourcesSection";
import { Button } from "@hexagen/ui";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import type { GeneratingFooterActions } from "./GenerateWithAi/types";

interface AIGenerationPageProps {
  llmContext: LocalLLMContext;
}

export function AIGenerationPage({ llmContext }: AIGenerationPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // originSpecText feeds the read-only Source row in the workbench's left
  // column (Plan Workbench C1) — present when this manifest came from an
  // imported/pasted spec, null in the plain prompt flow.
  const { set: setPendingManifest, originSpecText } = usePendingManifest();

  // The project name comes from the shared Project Name step (`?name=`). It is
  // also re-attached to the URL on Back/Regenerate from the accept screen so it
  // survives a round-trip through generation.
  const carriedName = searchParams.get("name")?.trim() || null;

  const [parseError, setParseError] = useState<string | null>(null);
  const [generatingActions, setGeneratingActions] =
    useState<GeneratingFooterActions | null>(null);

  const handleUseManifest = useCallback(
    (yaml: string) => {
      try {
        setParseError(null);
        const wizardData = parseManifestToWizardData(yaml);
        // The user-entered name (from the Project Name step) wins: it becomes the
        // saved-project name and seeds `governance.workspaceName` so the name is
        // factored into generated output. Fall back to the AI-derived name only
        // if the step was bypassed (e.g. a direct visit to /projects/new/ai).
        const projectName =
          carriedName ||
          wizardData.governance?.workspaceName ||
          `AI Project ${new Date().toLocaleTimeString()}`;
        // Keep the previewed/saved manifest string in sync with the carried
        // name: seed the form's workspaceName/namespacePrefix AND rewrite the
        // manifest's top-level system/scope so the Approve screen and saved
        // manifestYaml agree with formState (see manifestIdentity).
        let manifestYaml = yaml;
        if (carriedName && wizardData.governance) {
          const slug = deriveWorkspaceName(carriedName).name;
          const scope = `@${slug}`;
          wizardData.governance.workspaceName = slug;
          wizardData.governance.namespacePrefix = scope;
          manifestYaml = setManifestIdentity(yaml, { system: slug, scope });
        }
        setPendingManifest(
          manifestYaml,
          wizardData,
          projectName,
          "/projects/new/ai",
        );
        router.push("/projects/new/ai/accept");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to parse generated manifest";
        setParseError(message);
      }
    },
    [setPendingManifest, router, carriedName],
  );

  const renderFooter = () => {
    if (generatingActions) {
      // Once generation completes, GenerateWithAi supplies onNext and the
      // flow parks on the telemetry screen; a parse failure on Next retires
      // the button (the inline parseError above the content explains why).
      const isComplete = Boolean(generatingActions.onNext);
      return (
        <>
          <span />
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setParseError(null);
                generatingActions.onCancel();
              }}
            >
              {isComplete ? "Go Back" : "Cancel"}
            </Button>
            {isComplete && !parseError && (
              <Button onClick={generatingActions.onNext}>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </>
      );
    }

    return (
      <>
        <Button
          variant="secondary"
          onClick={() => router.push("/projects/new")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <span />
      </>
    );
  };

  return (
    <ProjectsShellWithFreeTier
      headerContent={
        <span className="font-semibold text-sm truncate">Generate with AI</span>
      }
      footer={renderFooter()}
    >
      <div className="h-full flex flex-col">
        {parseError && (
          <div className="p-4 mb-4 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive shrink-0">
            {parseError}
          </div>
        )}
        <div className="flex-1 min-h-0">
          {/* Plan Workbench C1: the genesis flow mounts the SHARED two-pane
              workbench. GenerateWithAi keeps every flow behavior (min-length
              gate, warning dialog, /models detour, parked telemetry) and hands
              this host the right-pane slots; the host owns the left column. */}
          <GenerateWithAi
            onUseManifest={handleUseManifest}
            llmContext={llmContext}
            onGeneratingStateChange={setGeneratingActions}
            renderWorkbench={({ main, composer }) => (
              <PlanWorkbench
                leftTitle="Plan"
                rightTitle="Generate"
                settings={
                  <GenesisProjectSettingsSection carriedName={carriedName} />
                }
                sessions={
                  <GenesisSourcesSection originSpecText={originSpecText} />
                }
                // No leftFooter: "Add planning session" is HIDDEN in genesis
                // (locked decision §5 Q1) — the hint lives in Section B's
                // muted empty-state line, never as a footer control.
                main={main}
                composer={composer}
              />
            )}
          />
        </div>
      </div>
    </ProjectsShellWithFreeTier>
  );
}
