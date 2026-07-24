"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
// Alias cross-slice import (same rationale as the plan-phase section): these
// are the wizard's step-1 field components, reused verbatim so genesis and
// plan phase render the identical Section A field set (plan §3.2).
import {
  IdentityFields,
  TemplateSelector,
  PackageManagerSelect,
  NamingConventionsFieldset,
} from "@/project-wizard/steps/workspace-governance-step";
import {
  loadGenesisFormValues,
  saveGenesisFormValues,
  seedGenesisFormValues,
} from "./genesisProjectSettingsStore";

interface GenesisProjectSettingsSectionProps {
  /** The `?name=` carried from the Project Name step; `null` when bypassed. */
  carriedName: string | null;
}

/**
 * GENESIS "Project settings" (Plan Workbench C1): the wizard's step-1 field
 * set on the workbench's left column, backed by its OWN small form — not the
 * wizard lifecycle context (the genesis flow has no WizardLifecycleProvider,
 * and the workbench host wires adapter props, never app contexts).
 *
 * Persistence model: there is NO record autosave here — no saved project
 * exists yet (the A1 `useProjectSettingsAutosave` is deliberately not mounted;
 * it no-ops entirely for a `null` projectId, and mounting a guaranteed no-op
 * would only suggest a write path that doesn't exist). Instead every edit is
 * mirrored into the module-scoped genesis store so the values survive the
 * accept screen's Back/Regenerate round trip, which remounts this page.
 * Feeding the edited values into the saved manifest (identity reconciliation)
 * is PR C2.
 */
export function GenesisProjectSettingsSection({
  carriedName,
}: GenesisProjectSettingsSectionProps) {
  // Seed once per mount: surviving values for THIS flow win over the seed so
  // Back/Regenerate keeps edits; a different carried name means a new flow
  // and re-seeds. useState's lazy initializer (not useMemo) — this must never
  // re-run and clobber live edits if the carried name identity flickers.
  const [defaultValues] = useState<ProjectConfig>(
    () =>
      loadGenesisFormValues(carriedName) ?? seedGenesisFormValues(carriedName),
  );
  const form = useForm<ProjectConfig>({ defaultValues });
  const { control } = form;

  useEffect(() => {
    // Subscription form of watch (the A1 autosave's pattern), not a render
    // read: mirroring to the module store is a side effect and must not
    // re-render the section on every keystroke. `name === undefined` marks a
    // programmatic reset, not a user edit — skip it so a remount can't write
    // the just-loaded values straight back.
    const subscription = form.watch((_values, info) => {
      if (info?.name === undefined) return;
      saveGenesisFormValues(carriedName, form.getValues());
    });
    return () => subscription.unsubscribe();
  }, [form, carriedName]);

  return (
    <section aria-label="Project settings" className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Workspace identity, template and conventions for the project you are
        about to generate.
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
