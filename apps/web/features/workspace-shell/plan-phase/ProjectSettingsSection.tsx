"use client";

import { useFormContext } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import {
  IdentityFields,
  TemplateSelector,
  PackageManagerSelect,
  NamingConventionsFieldset,
} from "@/workspace-governance-step";
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
 * Plan Workbench A2: the section renders inside the workbench's "Project
 * settings" accordion item, whose Trigger is the visible heading — so the
 * section carries no heading (or border chrome) of its own, only the
 * `aria-label` landmark and the autosave hint.
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
      className="space-y-4"
      // Flush the debounced autosave the moment focus leaves any field in the
      // section (React `onBlur` is focusout — it bubbles), so a blur commits
      // without waiting out the debounce.
      onBlur={() => flush()}
    >
      <p className="text-xs text-muted-foreground">
        Workspace identity, template and conventions — shared with the
        Architecture wizard. Changes save automatically.
      </p>
      <fieldset className="space-y-6">
        <IdentityFields control={control} />
        <TemplateSelector control={control} />
        <PackageManagerSelect control={control} />
        <NamingConventionsFieldset control={control} />
      </fieldset>
    </section>
  );
}
