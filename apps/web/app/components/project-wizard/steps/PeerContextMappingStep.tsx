"use client";

import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  PeerContextMapping,
} from "@hexagen/project-configuration";
import { getWorkspaceTemplate } from "@hexagen/shared";

import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";
import { useMenuFormView } from "@/hooks/useMenuFormView";
import {
  MappingList,
  MappingForm,
  getMappingId,
  createDefaultMapping,
} from "./peer-context-mapping-step";

interface PeerContextMappingStepProps {
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  activeMappingId?: string;
  onMappingSelect?: (id: string) => void;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

/**
 * Wizard step for defining peer context mappings — the directed
 * relationships between bounded contexts (consumer → provider with
 * an integration pattern and communication boundary).
 *
 * Mirrors BoundedContextStep's list/form flow. Both steps share the
 * useMenuFormView state machine so the UX is identical.
 */
export function PeerContextMappingStep({
  onNext,
  onBack,
  canProceed,
  activeMappingId,
  onMappingSelect,
  currentStep = 3,
  totalSteps = 6,
  title,
  description,
}: PeerContextMappingStepProps) {
  const { watch, setValue } = useFormContext<ProjectConfig>();
  const boundedContexts = watch("boundedContexts") || [];
  const peerMappings = watch("peerMappings") || [];
  const workspaceTemplate =
    watch("governance.workspaceTemplate") || "modular-monolith";
  const template = getWorkspaceTemplate(workspaceTemplate);
  const isStrictTemplate = template?.rules.strictness === "strict";

  const {
    view,
    confirmDeleteId,
    openMenu,
    openForm,
    requestDelete,
    cancelDelete,
  } = useMenuFormView<string>();

  const activeMapping = activeMappingId
    ? peerMappings.find((m) => getMappingId(m) === activeMappingId)
    : undefined;

  const handleSelectMapping = (id: string) => {
    onMappingSelect?.(id);
    openForm();
  };

  const handleAddMapping = () => {
    const next = createDefaultMapping({ boundedContexts, isStrictTemplate });
    if (!next) return;
    setValue("peerMappings", [...peerMappings, next]);
    onMappingSelect?.(getMappingId(next));
    openForm();
  };

  const handleUpdateMapping = (updates: Partial<PeerContextMapping>) => {
    if (!activeMapping) return;
    const activeIndex = peerMappings.findIndex(
      (m) => getMappingId(m) === activeMappingId,
    );
    if (activeIndex < 0) return;
    const updated = { ...peerMappings[activeIndex], ...updates };
    const next = peerMappings.map((m, i) => (i === activeIndex ? updated : m));
    setValue("peerMappings", next);
    if (updates.consumerContext || updates.providerContext) {
      onMappingSelect?.(getMappingId(updated));
    }
  };

  const handleConfirmDelete = (mappingId: string) => {
    const indexToDelete = peerMappings.findIndex(
      (m) => getMappingId(m) === mappingId,
    );
    if (indexToDelete < 0) {
      cancelDelete();
      return;
    }
    const next = [...peerMappings];
    next.splice(indexToDelete, 1);
    setValue("peerMappings", next);

    if (activeMappingId === mappingId) {
      if (next.length > 0) {
        const newActiveIndex = Math.min(indexToDelete, next.length - 1);
        onMappingSelect?.(getMappingId(next[newActiveIndex]));
        openMenu();
      } else {
        onMappingSelect?.("");
      }
    }
    cancelDelete();
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Peer Context Mappings"}
        description={description || "Define how contexts interact."}
      />

      {view === "menu" || !activeMapping ? (
        <MappingList
          mappings={peerMappings}
          boundedContexts={boundedContexts}
          activeMappingId={activeMappingId}
          confirmDeleteId={confirmDeleteId}
          onSelectMapping={handleSelectMapping}
          onAddMapping={handleAddMapping}
          onRequestDelete={requestDelete}
          onConfirmDelete={handleConfirmDelete}
          onCancelDelete={cancelDelete}
        />
      ) : (
        <MappingForm
          mapping={activeMapping}
          boundedContexts={boundedContexts}
          isStrictTemplate={isStrictTemplate}
          onBack={openMenu}
          onUpdate={handleUpdateMapping}
        />
      )}

      <WizardFooter
        onBack={onBack}
        onNext={onNext}
        canProceed={canProceed}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
    </div>
  );
}
