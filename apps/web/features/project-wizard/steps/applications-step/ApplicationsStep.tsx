"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type {
  ProjectConfig,
  BoundedContext,
} from "@hexagen/project-configuration";

import { StepHeader } from "../StepHeader";
import { WizardFooter } from "../../WizardFooter";
import {
  apiFrameworkOptions,
  uiFrameworkOptions,
} from "@/project-wizard/config";
import {
  collapseApplications,
  fanOutApplications,
  type InfrastructureTarget,
  type UiFramework,
} from "./applications-config";

interface ApplicationsStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
  readOnly?: boolean;
}

const FIELD_LABEL_CLASSES =
  "block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5";
const SELECT_CLASSES =
  "w-full px-3 py-2 border border-input rounded-md text-sm bg-background focus:ring-2 focus:ring-ring focus:border-transparent outline-none disabled:opacity-50";

/**
 * Project-level Applications step (ADR-0041). UI framework + API backend are a
 * single project-wide choice here, not per-context selects. The choice is fanned
 * out to every bounded context's persisted fields via react-hook-form `setValue`
 * — the single state path — so `deriveApps` collapses them into one `web` + one
 * `api`. Placed before Bounded Contexts so new contexts inherit the choice at
 * creation (see `createEmptyContext`).
 */
export function ApplicationsStep({
  onNext,
  onBack,
  canProceed,
  currentStep = 2,
  totalSteps = 8,
  title,
  description,
  readOnly,
}: ApplicationsStepProps) {
  const { control, getValues, setValue } = useFormContext<ProjectConfig>();
  const boundedContexts = useWatch({ control, name: "boundedContexts" }) ?? [];

  const collapse = useMemo(
    () => collapseApplications(boundedContexts),
    [boundedContexts],
  );

  // Snapshot whether the project ARRIVED with divergent per-context values,
  // before the normalize effect below makes the live collapse consistent —
  // otherwise the notice would vanish the instant we unify.
  const arrivedDivergedRef = useRef<boolean | null>(null);
  if (arrivedDivergedRef.current === null) {
    arrivedDivergedRef.current = collapse.uiDiverged || collapse.infraDiverged;
  }

  // The divergence notice is informational; once dismissed it stays hidden for
  // the session.
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const showDivergence =
    Boolean(arrivedDivergedRef.current) && !noticeDismissed;

  // Persist the collapsed selection to every context so the displayed selection
  // is exactly what gets generated — regardless of how the user leaves the step
  // (Next, Back, or jumping via the step nav) and even if they never touch a
  // select. This is the ADR-0041 D4 convergence: a loaded/legacy project with
  // divergent OR missing per-context values is normalized to the shown value on
  // entry. Already-consistent projects are skipped (no render loop, no spurious
  // dirty); headless ("") is preserved because the collapse yields "" for an
  // all-headless project. Skipped while read-only (AI-generated preview).
  useEffect(() => {
    if (readOnly) return;
    const current = (getValues("boundedContexts") ?? []) as BoundedContext[];
    if (current.length === 0) return;
    const consistent = current.every(
      (c) =>
        c.uiFramework === collapse.uiFramework &&
        c.infrastructureTarget === collapse.infrastructureTarget,
    );
    if (consistent) return;
    setValue(
      "boundedContexts",
      fanOutApplications(current, {
        uiFramework: collapse.uiFramework,
        infrastructureTarget: collapse.infrastructureTarget,
      }),
      { shouldDirty: true },
    );
  }, [collapse, readOnly, getValues, setValue]);

  const fanOut = (selection: {
    uiFramework: UiFramework;
    infrastructureTarget: InfrastructureTarget;
  }) => {
    const current = (getValues("boundedContexts") ?? []) as BoundedContext[];
    setValue("boundedContexts", fanOutApplications(current, selection), {
      shouldDirty: true,
    });
  };

  const handleUiChange = (value: UiFramework) =>
    fanOut({
      uiFramework: value,
      infrastructureTarget: collapse.infrastructureTarget,
    });

  const handleInfraChange = (value: InfrastructureTarget) =>
    fanOut({ uiFramework: collapse.uiFramework, infrastructureTarget: value });

  const uiLabel =
    uiFrameworkOptions.find((o) => o.value === collapse.uiFramework)?.label ??
    collapse.uiFramework;
  const infraLabel =
    apiFrameworkOptions.find((o) => o.value === collapse.infrastructureTarget)
      ?.label ?? collapse.infrastructureTarget;

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Applications"}
        description={
          description ||
          "Choose the UI framework and API backend for your project's application. This applies to the whole project, not individual bounded contexts."
        }
        autoGenerated={readOnly}
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {showDivergence && (
          <div
            role="status"
            className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          >
            <div className="flex items-start justify-between gap-3">
              <span>
                Your bounded contexts had different UI/API settings — we&apos;ve
                unified them to <strong>{uiLabel || "Headless"}</strong> +{" "}
                <strong>{infraLabel}</strong>. Change the selection below if
                needed.
              </span>
              <button
                type="button"
                onClick={() => setNoticeDismissed(true)}
                className="shrink-0 text-amber-700 hover:text-amber-900 dark:text-amber-300"
                aria-label="Dismiss notice"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <fieldset disabled={readOnly} className="space-y-4">
          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>UI Framework</span>
            <select
              value={collapse.uiFramework}
              onChange={(e) => handleUiChange(e.target.value as UiFramework)}
              className={SELECT_CLASSES}
            >
              {uiFrameworkOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={FIELD_LABEL_CLASSES}>API Backend</span>
            <select
              value={collapse.infrastructureTarget}
              onChange={(e) =>
                handleInfraChange(e.target.value as InfrastructureTarget)
              }
              className={SELECT_CLASSES}
            >
              {apiFrameworkOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <p className="text-xs text-muted-foreground">
            One application spans every bounded context. Per-context driven
            infra (persistence, messaging, telemetry) is configured on each
            context.
          </p>
        </fieldset>
      </div>

      <WizardFooter
        onNext={onNext}
        onBack={onBack}
        canProceed={canProceed}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
    </div>
  );
}
