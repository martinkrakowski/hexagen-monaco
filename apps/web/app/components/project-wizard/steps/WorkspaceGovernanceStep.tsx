"use client";

import { useFormContext } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { workspaceTemplates, getWorkspaceTemplate } from "@hexagen/shared";
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
  const workspaceTemplate =
    watch("governance.workspaceTemplate") || "modular-monolith";
  const workspaceDescription = watch("governance.workspaceDescription") || "";
  const packageManager = watch("governance.packageManager") || "yarn";
  const namespacePrefix = watch("governance.namespacePrefix") || "@hexagen";
  const contextDirectoryPattern =
    watch("governance.namingConventions.contextDirectoryPattern") ||
    "packages/";
  const adapterSuffix =
    watch("governance.namingConventions.adapterSuffix") || ".adapter.ts";

  const selectedTemplate = getWorkspaceTemplate(workspaceTemplate);

  const handleNext = () => {
    setValue("governance.workspaceName", workspaceName.trim());
    setValue("governance.workspaceTemplate", workspaceTemplate);
    setValue("governance.workspaceDescription", workspaceDescription.trim());
    setValue("governance.packageManager", packageManager);
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
        description={
          description ||
          "Define workspace settings and select an architectural template."
        }
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

          {/* Workspace Description */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <input
              value={workspaceDescription}
              onChange={(e) =>
                setValue("governance.workspaceDescription", e.target.value)
              }
              className="w-full px-4 py-2 bg-background border border-input rounded-md"
              placeholder="Core enterprise platform monorepo"
            />
          </div>

          {/* Workspace Template Selector */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Architectural Template
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                This determines cross-context communication rules and isolation
                boundaries for the generated project.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {workspaceTemplates.map((template) => {
                const isSelected = workspaceTemplate === template.id;
                return (
                  <div
                    key={template.id}
                    onClick={() =>
                      setValue(
                        "governance.workspaceTemplate",
                        template.id as ProjectConfig["governance"]["workspaceTemplate"],
                      )
                    }
                    className={`relative flex flex-col p-4 cursor-pointer rounded-xl border-2 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/50 hover:bg-muted/30"
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-primary" />
                    )}
                    <div className="font-semibold text-sm mb-1 pr-5">
                      {template.title}
                    </div>
                    <p className="text-xs text-muted-foreground flex-1 line-clamp-3">
                      {template.description}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-3">
                      {template.rules.strictness === "strict" ? (
                        <span className="text-[10px] bg-destructive/10 text-destructive px-2 py-0.5 rounded">
                          Strict
                        </span>
                      ) : (
                        <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded">
                          Flexible
                        </span>
                      )}
                      {template.rules.crossContextCalls === "in-process" && (
                        <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded">
                          In-Process
                        </span>
                      )}
                      {template.rules.crossContextCalls === "event-bus" && (
                        <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded">
                          Event-Driven
                        </span>
                      )}
                      {template.rules.crossContextCalls === "network" && (
                        <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded">
                          Networked
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Template Details */}
            {selectedTemplate && (
              <div className="p-3 bg-muted/40 border border-border rounded-lg space-y-2">
                <div className="text-xs font-semibold text-foreground">
                  {selectedTemplate.title}
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {selectedTemplate.rules.allowSharedUi ? (
                    <div>Shared UI app allowed</div>
                  ) : (
                    <div>UI isolated per context</div>
                  )}
                  {selectedTemplate.rules.crossContextCalls ===
                    "in-process" && (
                    <div>Direct TypeScript imports between contexts</div>
                  )}
                  {selectedTemplate.rules.crossContextCalls === "event-bus" && (
                    <div>All cross-context calls via event bus</div>
                  )}
                  {selectedTemplate.rules.crossContextCalls === "network" && (
                    <div>All cross-context calls via network RPC</div>
                  )}
                </div>
              </div>
            )}
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
