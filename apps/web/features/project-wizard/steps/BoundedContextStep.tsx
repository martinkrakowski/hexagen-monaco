"use client";

import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  BoundedContext,
} from "@hexagen/project-configuration";

import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";
import { useMenuFormView } from "../hooks/useMenuFormView";
import {
  ContextList,
  ContextForm,
  createEmptyContext,
} from "./bounded-context-step";

interface BoundedContextStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  activeContextId?: string;
  onContextSelect?: (id: string) => void;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

/**
 * Wizard step for defining and configuring bounded contexts.
 * Orchestrates two views — a list view (menu) and a per-context form
 * view — plus an inline delete-confirm overlay. The list/form state
 * machine lives in useMenuFormView (shared with PeerContextMappingStep).
 *
 * Sub-components (ContextList, ContextForm, ContextCard, etc.) live
 * under ./bounded-context-step/.
 */
export function BoundedContextStep({
  onNext,
  onBack,
  canProceed,
  activeContextId,
  onContextSelect,
  currentStep = 2,
  totalSteps = 6,
  title,
  description,
}: BoundedContextStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();
  const boundedContexts = watch("boundedContexts") || [];

  const {
    view,
    confirmDeleteId,
    openMenu,
    openForm,
    requestDelete,
    cancelDelete,
  } = useMenuFormView<string>();

  const activeContext = boundedContexts.find((c) => c.id === activeContextId);
  const activeIndex = boundedContexts.findIndex(
    (c) => c.id === activeContextId,
  );

  const isNextDisabled =
    !canProceed || boundedContexts.some((c) => !c.name?.trim());

  const handleSelectContext = (id: string) => {
    onContextSelect?.(id);
    openForm();
  };

  const handleAddContext = () => {
    const next = createEmptyContext();
    setValue("boundedContexts", [...boundedContexts, next]);
    onContextSelect?.(next.id);
    openForm();
  };

  const handleUpdateContext = (
    updater: (ctx: BoundedContext) => BoundedContext,
  ) => {
    if (activeIndex < 0) return;
    const next = boundedContexts.map((ctx, i) =>
      i === activeIndex ? updater(ctx) : ctx,
    );
    setValue("boundedContexts", next, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const handleConfirmDelete = (contextId: string) => {
    const indexToDelete = boundedContexts.findIndex((c) => c.id === contextId);
    if (indexToDelete < 0) {
      cancelDelete();
      return;
    }
    const next = [...boundedContexts];
    next.splice(indexToDelete, 1);
    setValue("boundedContexts", next);

    if (activeContextId === contextId) {
      if (next.length > 0) {
        const newActiveIndex = Math.min(indexToDelete, next.length - 1);
        onContextSelect?.(next[newActiveIndex].id);
        openMenu();
      } else {
        onContextSelect?.("");
      }
    }
    cancelDelete();
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Bounded Contexts"}
        description={description || "Add and configure bounded contexts."}
      />

      {view === "menu" || !activeContext ? (
        <ContextList
          contexts={boundedContexts}
          activeContextId={activeContextId}
          confirmDeleteId={confirmDeleteId}
          onSelectContext={handleSelectContext}
          onAddContext={handleAddContext}
          onRequestDelete={requestDelete}
          onConfirmDelete={handleConfirmDelete}
          onCancelDelete={cancelDelete}
        />
      ) : (
        <ContextForm
          context={activeContext}
          fieldPrefix={`boundedContexts.${activeIndex}`}
          onBack={openMenu}
          onUpdate={handleUpdateContext}
        />
      )}

      <WizardFooter
        onBack={onBack}
        onNext={onNext}
        canProceed={!isNextDisabled}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
    </div>
  );
}
