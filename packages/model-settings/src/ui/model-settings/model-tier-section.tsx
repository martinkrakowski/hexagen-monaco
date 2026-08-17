import { ModelCard, type ModelCardStatus } from "./model-card";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm/client";

/**
 * The catalog fields this section renders. Structural on purpose: the tier
 * list is projected by the container, so the presentational tree never has to
 * reach for `LOCAL_MODELS` itself.
 */
export interface ModelTierDescriptor {
  readonly modelId: DomainModelId;
  readonly displayName: string;
  readonly description: string;
  readonly downloadSizeGB: number;
  readonly vramRequiredMB: number;
  readonly codingRating: number;
}

export interface ModelTierSectionProps {
  title: string;
  descriptors: readonly ModelTierDescriptor[];
  currentModelId: DomainModelId | null;
  selectedModelId: DomainModelId | null;
  confirmDeleteId: DomainModelId | null;
  pendingSwitchId: DomainModelId | null;
  recommendedModelId: DomainModelId | null;
  cacheStatusMap: ReadonlyMap<
    DomainModelId,
    { isCached: boolean; isChecking: boolean }
  >;
  onSelectModel: (modelId: DomainModelId) => void;
  onDelete: (modelId: DomainModelId) => void;
  onConfirmDelete: (modelId: DomainModelId) => void;
  onCancelDelete: () => void;
  onConfirmSwitch: () => void;
  onCancelSwitch: () => void;
  currentModelDisplayName: string | null;
  isLoading: boolean;
  isSwitching: boolean;
  isDeleting: boolean;
  error: string | null;
  loadedModel: ModelMetadata | null;
  isRecommended?: boolean;
  compatibilityIssue?: { reason: string; severity: "warning" | "error" } | null;
  downloadingModelId?: DomainModelId | null;
  downloadProgress?: number;
}

export function ModelTierSection({
  title,
  descriptors,
  currentModelId,
  selectedModelId,
  confirmDeleteId,
  pendingSwitchId,
  recommendedModelId,
  cacheStatusMap,
  onSelectModel,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onConfirmSwitch,
  onCancelSwitch,
  currentModelDisplayName,
  isLoading,
  isSwitching,
  isDeleting,
  error,
  loadedModel,
  compatibilityIssue,
  downloadingModelId = null,
  downloadProgress = 0,
}: ModelTierSectionProps) {
  if (descriptors.length === 0) return null;

  const getCardStatus = (modelId: DomainModelId): ModelCardStatus => {
    if (confirmDeleteId === modelId) return { status: "confirm-delete" };
    if (pendingSwitchId === modelId) return { status: "pending-switch" };
    return { status: "default" };
  };

  return (
    <div className="mb-6">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase mb-3">
        {title}
      </h2>
      <div className="space-y-3">
        {descriptors.map((descriptor) => (
          <ModelCard
            key={descriptor.modelId}
            descriptor={descriptor}
            isCurrent={currentModelId === descriptor.modelId}
            cardStatus={getCardStatus(descriptor.modelId)}
            cacheStatus={cacheStatusMap.get(descriptor.modelId)}
            onSelectModel={() => onSelectModel(descriptor.modelId)}
            onDelete={() => {
              onDelete(descriptor.modelId);
            }}
            onConfirmDelete={() => onConfirmDelete(descriptor.modelId)}
            onCancelDelete={onCancelDelete}
            onConfirmSwitch={onConfirmSwitch}
            onCancelSwitch={onCancelSwitch}
            currentModelDisplayName={currentModelDisplayName}
            isLoading={isLoading}
            isSwitching={isSwitching}
            isDeleting={isDeleting}
            error={error}
            loadedModel={loadedModel}
            isRecommended={descriptor.modelId === recommendedModelId}
            compatibilityIssue={
              selectedModelId === descriptor.modelId
                ? (compatibilityIssue ?? null)
                : null
            }
            isDownloading={downloadingModelId === descriptor.modelId}
            downloadProgress={
              downloadingModelId === descriptor.modelId
                ? downloadProgress
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
