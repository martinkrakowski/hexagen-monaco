"use client";

import { useFormContext } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";

import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";
import {
  IdentityFields,
  TemplateSelector,
  PackageManagerSelect,
  NamingConventionsFieldset,
  type PackageManager,
} from "./workspace-governance-step";

interface WorkspaceGovernanceStepProps {
  onNext: () => void;
  onShowSavedProjects: () => void;
  canProceed: boolean;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

/**
 * Wizard step for workspace-wide settings: identity (name/description/
 * namespace), architectural template, package manager, and code-gen
 * naming conventions. Each concern lives in its own sub-component
 * under ./workspace-governance-step/.
 */
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
  const workspaceDescription = watch("governance.workspaceDescription") || "";
  const namespacePrefix = watch("governance.namespacePrefix") || "@hexagen";
  const workspaceTemplate =
    watch("governance.workspaceTemplate") || "modular-monolith";
  const packageManager = (watch("governance.packageManager") ||
    "yarn") as PackageManager;
  const contextDirectoryPattern =
    watch("governance.namingConventions.contextDirectoryPattern") ||
    "packages/";
  const adapterSuffix =
    watch("governance.namingConventions.adapterSuffix") || ".adapter.ts";

  // Trim free-text fields on submit. Select/template fields don't need
  // trimming — the values come from controlled dropdowns.
  const handleNext = () => {
    setValue("governance.workspaceName", workspaceName.trim());
    setValue("governance.workspaceDescription", workspaceDescription.trim());
    setValue("governance.namespacePrefix", namespacePrefix.trim());
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
          <IdentityFields
            workspaceName={workspaceName}
            workspaceDescription={workspaceDescription}
            namespacePrefix={namespacePrefix}
            onChangeName={(v) => setValue("governance.workspaceName", v)}
            onChangeDescription={(v) =>
              setValue("governance.workspaceDescription", v)
            }
            onChangeNamespacePrefix={(v) =>
              setValue("governance.namespacePrefix", v)
            }
          />

          <TemplateSelector
            selectedTemplateId={workspaceTemplate}
            onSelectTemplate={(id) =>
              setValue(
                "governance.workspaceTemplate",
                id as ProjectConfig["governance"]["workspaceTemplate"],
              )
            }
          />

          <PackageManagerSelect
            value={packageManager}
            onChange={(v) => setValue("governance.packageManager", v)}
          />

          <NamingConventionsFieldset
            contextDirectoryPattern={contextDirectoryPattern}
            adapterSuffix={adapterSuffix}
            onChangeContextDirectoryPattern={(v) =>
              setValue(
                "governance.namingConventions.contextDirectoryPattern",
                v,
              )
            }
            onChangeAdapterSuffix={(v) =>
              setValue("governance.namingConventions.adapterSuffix", v)
            }
          />
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
