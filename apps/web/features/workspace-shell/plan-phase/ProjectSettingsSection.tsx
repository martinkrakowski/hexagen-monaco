"use client";

import { useFormContext } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import {
  IdentityFields,
  TemplateSelector,
  PackageManagerSelect,
  NamingConventionsFieldset,
} from "../../project-wizard/steps/workspace-governance-step";
import { useProjectSettingsAutosave } from "./useProjectSettingsAutosave";

interface ProjectSettingsSectionProps {
  /** The saved project these edits persist to. */
  projectId: string;
  /** Record-level, formState-only autosave (`updateProjectFormState`). */
  persist: (id: string, formState: ProjectConfig) => void;
}

/**
 * Plan-phase "Project settings": the wizard's step-1 governance fields with no
 * step chrome (no `StepHeader` / `WizardFooter`), plus the stepless autosave the
 * wizard's step-navigation writes never cover. Edits flow into the SAME shared
 * form instance as the wizard (`WizardStepFormProvider`), so workspace name,
 * template, package manager and naming conventions stay one source of truth
 * across both phases.
 *
 * Plan Workbench PR A1: the collapsible accordion + two-pane layout land in A2.
 * Here the section renders inline in the existing single-column plan view so the
 * new persistence path is reviewable in isolation.
 */
export function ProjectSettingsSection({
  projectId,
  persist,
}: ProjectSettingsSectionProps) {
  const form = useFormContext<ProjectConfig>();
  const { control } = form;
  const { flush } = useProjectSettingsAutosave({ projectId, form, persist });

  return (
    <section
      aria-label="Project settings"
      className="border border-border rounded-lg p-4 space-y-4"
      // Flush the debounced autosave the moment focus leaves any field in the
      // section (React `onBlur` is focusout — it bubbles), so a blur commits
      // without waiting out the debounce.
      onBlur={() => flush()}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">
          Project settings
        </h2>
        <p className="text-xs text-muted-foreground">
          Workspace identity, template and conventions — shared with the
          Architecture wizard. Changes save automatically.
        </p>
      </div>
      <fieldset className="space-y-6">
        <IdentityFields control={control} />
        <TemplateSelector control={control} />
        <PackageManagerSelect control={control} />
        <NamingConventionsFieldset control={control} />
      </fieldset>
    </section>
  );
}
