"use client";

import { useFormContext } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";

interface WorkspaceGovernanceStepProps {
  onNext: () => void;
  onShowSavedProjects: () => void;
  canProceed: boolean;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

export function WorkspaceGovernanceStep({
  onNext,
  onShowSavedProjects,
  canProceed,
  currentStep = 1,
  totalSteps = 6,
  title,
  description,
}: WorkspaceGovernanceStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();

  const workspaceName = watch("governance.workspaceName") || "";
  const packageManager = watch("governance.packageManager") || "yarn";
  const topologyStrictness =
    watch("governance.topologyStrictness") || "flexible";
  const namespacePrefix = watch("governance.namespacePrefix") || "@hexagen";
  const contextDirectoryPattern =
    watch("governance.namingConventions.contextDirectoryPattern") ||
    "packages/";
  const adapterSuffix =
    watch("governance.namingConventions.adapterSuffix") || ".adapter.ts";

  const handleNext = () => {
    setValue("governance.workspaceName", workspaceName.trim());
    setValue("governance.packageManager", packageManager);
    setValue("governance.topologyStrictness", topologyStrictness);
    setValue("governance.namespacePrefix", namespacePrefix.trim());
    setValue(
      "governance.namingConventions.contextDirectoryPattern",
      contextDirectoryPattern,
    );
    setValue("governance.namingConventions.adapterSuffix", adapterSuffix);
    onNext();
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Workspace Governance"}
        description={description || "Define workspace settings."}
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        <div className="space-y-6">
          {/* Workspace Name */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Workspace Name
            </label>
            <input
              value={workspaceName}
              onChange={(e) =>
                setValue("governance.workspaceName", e.target.value)
              }
              className="w-full px-4 py-2 bg-background border border-input rounded-md"
              placeholder="@mycompany"
            />
          </div>

          {/* Package Manager */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Package Manager
            </label>
            <select
              value={packageManager}
              onChange={(e) =>
                setValue(
                  "governance.packageManager",
                  e.target.value as "yarn" | "pnpm" | "bun",
                )
              }
              className="w-full px-4 py-2 bg-background border border-input rounded-md"
            >
              <option value="yarn">Yarn</option>
              <option value="pnpm">PNPM</option>
              <option value="bun">Bun</option>
            </select>
          </div>

          {/* Topology Strictness */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Topology Strictness
            </label>
            <select
              value={topologyStrictness}
              onChange={(e) =>
                setValue(
                  "governance.topologyStrictness",
                  e.target.value as "strict" | "flexible",
                )
              }
              className="w-full px-4 py-2 bg-background border border-input rounded-md"
            >
              <option value="strict">
                Strict (Zero sharing between adapters)
              </option>
              <option value="flexible">Flexible (Allows shared-kernel)</option>
            </select>
          </div>

          {/* Namespace Prefix */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Namespace Prefix
            </label>
            <input
              value={namespacePrefix}
              onChange={(e) =>
                setValue("governance.namespacePrefix", e.target.value)
              }
              className="w-full px-4 py-2 bg-background border border-input rounded-md"
              placeholder="@hexagen"
            />
          </div>

          {/* Naming Conventions */}
          <div className="p-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Naming Conventions
            </h3>

            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Context Directory Pattern
                </label>
                <input
                  value={contextDirectoryPattern}
                  onChange={(e) =>
                    setValue(
                      "governance.namingConventions.contextDirectoryPattern",
                      e.target.value,
                    )
                  }
                  className="w-full px-3 py-2 bg-background border border-input rounded-md"
                  placeholder="packages/"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Adapter Suffix
                </label>
                <input
                  value={adapterSuffix}
                  onChange={(e) =>
                    setValue(
                      "governance.namingConventions.adapterSuffix",
                      e.target.value,
                    )
                  }
                  className="w-full px-3 py-2 bg-background border border-input rounded-md"
                  placeholder=".adapter.ts"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <WizardFooter
        onShowSavedProjects={onShowSavedProjects}
        onNext={handleNext}
        canProceed={Boolean(
          canProceed && workspaceName.trim() && namespacePrefix.trim(),
        )}
        currentStep={currentStep}
        totalSteps={totalSteps}
        showBack={false}
      />
    </div>
  );
}
