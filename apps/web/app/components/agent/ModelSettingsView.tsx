"use client";

import { useState, useEffect } from "react";
import { LOCAL_MODELS, getModelDescriptor } from "@/config/models";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm";
import { ArrowLeft } from "lucide-react";
import { ModelFooterIndicator } from "./ModelFooterIndicator";
import { useHardwareDetection } from "@/hooks/use-hardware-detection";
import { recommendModel, checkCompatibility } from "@/lib/model-recommendation";

interface ModelSettingsViewProps {
  currentModelId: DomainModelId | null;
  loadedModel: ModelMetadata | null;
  messagesLength: number;
  onSwitchModel: (modelId: DomainModelId) => Promise<void>;
  onDeleteModel: (modelId: DomainModelId) => Promise<void>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
  /**
   * Callback to navigate back to the main governance view.
   * Pass undefined to hide the back button during initial model selection,
   * when the user has not yet selected a model and cannot navigate back.
   */
  onBack?: () => void;
  isLoading: boolean;
  onSwitchToCloud?: () => void;
  requiresModelWarning?: boolean;
}

interface ModelCacheStatus {
  modelId: DomainModelId;
  isCached: boolean;
  isChecking: boolean;
}

export function ModelSettingsView({
  currentModelId,
  loadedModel,
  messagesLength,
  onSwitchModel,
  onDeleteModel,
  hasModelInCache,
  onBack,
  isLoading,
  onSwitchToCloud,
  requiresModelWarning,
}: ModelSettingsViewProps) {
  const [cacheStatus, setCacheStatus] = useState<
    Map<DomainModelId, ModelCacheStatus>
  >(new Map());
  const [confirmDeleteId, setConfirmDeleteId] = useState<DomainModelId | null>(
    null,
  );
  const [pendingSwitchId, setPendingSwitchId] = useState<DomainModelId | null>(
    null,
  );
  const [isSwitching, setIsSwitching] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Hardware detection and recommendation
  const { profile: hardwareProfile, isDetecting: isDetectingHardware } =
    useHardwareDetection();
  const [recommendedModelId, setRecommendedModelId] =
    useState<DomainModelId | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<DomainModelId | null>(
    currentModelId,
  );

  useEffect(() => {
    setSelectedModelId(currentModelId);
  }, [currentModelId]);

  // Compute hardware recommendation when profile is available
  useEffect(() => {
    if (hardwareProfile && !isDetectingHardware) {
      const recommendation = recommendModel(hardwareProfile, LOCAL_MODELS);
      setRecommendedModelId(recommendation?.modelId ?? null);
    }
  }, [hardwareProfile, isDetectingHardware]);

  // Query cache status for all models on mount
  useEffect(() => {
    const queryCacheStatus = async () => {
      const newStatus = new Map<DomainModelId, ModelCacheStatus>();
      for (const model of LOCAL_MODELS) {
        newStatus.set(model.modelId, {
          modelId: model.modelId,
          isCached: false,
          isChecking: true,
        });
      }
      setCacheStatus(newStatus);

      // Query in parallel
      const results = await Promise.all(
        LOCAL_MODELS.map(async (model) => {
          try {
            const isCached = await hasModelInCache(model.modelId);
            return {
              modelId: model.modelId,
              isCached,
            };
          } catch {
            // If query fails, assume not cached
            return {
              modelId: model.modelId,
              isCached: false,
            };
          }
        }),
      );

      const finalStatus = new Map<DomainModelId, ModelCacheStatus>();
      for (const result of results) {
        finalStatus.set(result.modelId, {
          modelId: result.modelId,
          isCached: result.isCached,
          isChecking: false,
        });
      }
      setCacheStatus(finalStatus);
    };

    queryCacheStatus();
  }, [hasModelInCache]);

  const handleSelectModel = async (modelId: DomainModelId) => {
    if (modelId === currentModelId) {
      return;
    }

    if (messagesLength > 0) {
      setPendingSwitchId(modelId);
      return;
    }

    await doSwitch(modelId);
  };

  const doSwitch = async (modelId: DomainModelId) => {
    setIsSwitching(true);
    try {
      await onSwitchModel(modelId);
    } finally {
      setIsSwitching(false);
      setPendingSwitchId(null);
    }
  };

  const handleConfirmSwitch = async () => {
    if (pendingSwitchId) {
      await doSwitch(pendingSwitchId);
    }
  };

  const handleDelete = async (modelId: DomainModelId) => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("Delete operation timed out")),
          60000,
        ),
      );
      await Promise.race([onDeleteModel(modelId), timeoutPromise]);
      setConfirmDeleteId(null);
      // Refresh cache status after deletion
      const isCached = await hasModelInCache(modelId);
      setCacheStatus((prev) => {
        const newStatus = new Map(prev);
        newStatus.set(modelId, {
          modelId,
          isCached,
          isChecking: false,
        });
        return newStatus;
      });
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete model",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const totalCached = Array.from(cacheStatus.values()).filter(
    (s) => s.isCached,
  ).length;
  const totalCachedSize = LOCAL_MODELS.reduce((sum, model) => {
    if (cacheStatus.get(model.modelId)?.isCached) {
      return sum + model.downloadSizeGB;
    }
    return sum;
  }, 0);

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="mb-4 px-2 py-3 flex-shrink-0 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground/80 hover:bg-muted/60 transition-colors"
                title="Back to governance"
                aria-label="Back to governance"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            <h1 className="text-[15px] font-semibold text-foreground tracking-tight">
              AI Model Settings
            </h1>
          </div>
        </div>
        <p className="text-xs text-muted-foreground font-normal pl-[38px]">
          Select and manage AI models
        </p>
      </div>

      {/* Warning Banner when no model is loaded */}
      {requiresModelWarning && (
        <div className="mb-4 mx-2 px-3 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
          <p className="text-sm text-amber-800 dark:text-amber-200 font-medium mb-1.5">
            A model is required
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Please select and download a model to continue using the AI
            Governance panel.
          </p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-5">
        {/* Recommended for You Section */}
        {recommendedModelId && !isDetectingHardware && (
          <div className="mb-6">
            <h2 className="text-[12px] font-semibold text-muted-foreground uppercase mb-3">
              ✨ Recommended for Your System
            </h2>
            {LOCAL_MODELS.find((m) => m.modelId === recommendedModelId) && (
              <ModelCard
                descriptor={
                  LOCAL_MODELS.find((m) => m.modelId === recommendedModelId)!
                }
                isCurrent={currentModelId === recommendedModelId}
                isPendingSwitch={pendingSwitchId === recommendedModelId}
                isConfirmDelete={confirmDeleteId === recommendedModelId}
                cacheStatus={cacheStatus.get(recommendedModelId)}
                onSelectModel={handleSelectModel}
                onDelete={() => {
                  setConfirmDeleteId(recommendedModelId);
                  setDeleteError(null);
                }}
                onConfirmDelete={() => handleDelete(recommendedModelId)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                isLoading={isLoading}
                isSwitching={isSwitching}
                isDeleting={isDeleting}
                deleteError={deleteError}
                loadedModel={loadedModel}
                isRecommended={true}
              />
            )}
          </div>
        )}

        {/* Desktop High-End Section */}
        {LOCAL_MODELS.some((m) => m.tier === "desktop-high") && (
          <div className="mb-6">
            <h2 className="text-[12px] font-semibold text-muted-foreground uppercase mb-3">
              Desktop
            </h2>
            <div className="space-y-3">
              {LOCAL_MODELS.filter((m) => m.tier === "desktop-high").map(
                (descriptor) => (
                  <ModelCard
                    key={descriptor.modelId}
                    descriptor={descriptor}
                    isCurrent={currentModelId === descriptor.modelId}
                    isPendingSwitch={pendingSwitchId === descriptor.modelId}
                    isConfirmDelete={confirmDeleteId === descriptor.modelId}
                    cacheStatus={cacheStatus.get(descriptor.modelId)}
                    onSelectModel={handleSelectModel}
                    onDelete={() => {
                      setConfirmDeleteId(descriptor.modelId);
                      setDeleteError(null);
                    }}
                    onConfirmDelete={() => handleDelete(descriptor.modelId)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    isLoading={isLoading}
                    isSwitching={isSwitching}
                    isDeleting={isDeleting}
                    deleteError={deleteError}
                    loadedModel={loadedModel}
                    isRecommended={descriptor.modelId === recommendedModelId}
                    compatibilityIssue={
                      selectedModelId === descriptor.modelId
                        ? checkCompatibility(descriptor, hardwareProfile)
                        : null
                    }
                  />
                ),
              )}
            </div>
          </div>
        )}

        {/* Desktop Compact Section */}
        {LOCAL_MODELS.some((m) => m.tier === "desktop-compact") && (
          <div className="mb-6">
            <h2 className="text-[12px] font-semibold text-muted-foreground uppercase mb-3">
              Compact
            </h2>
            <div className="space-y-3">
              {LOCAL_MODELS.filter((m) => m.tier === "desktop-compact").map(
                (descriptor) => (
                  <ModelCard
                    key={descriptor.modelId}
                    descriptor={descriptor}
                    isCurrent={currentModelId === descriptor.modelId}
                    isPendingSwitch={pendingSwitchId === descriptor.modelId}
                    isConfirmDelete={confirmDeleteId === descriptor.modelId}
                    cacheStatus={cacheStatus.get(descriptor.modelId)}
                    onSelectModel={handleSelectModel}
                    onDelete={() => {
                      setConfirmDeleteId(descriptor.modelId);
                      setDeleteError(null);
                    }}
                    onConfirmDelete={() => handleDelete(descriptor.modelId)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    isLoading={isLoading}
                    isSwitching={isSwitching}
                    isDeleting={isDeleting}
                    deleteError={deleteError}
                    loadedModel={loadedModel}
                    isRecommended={descriptor.modelId === recommendedModelId}
                    compatibilityIssue={
                      selectedModelId === descriptor.modelId
                        ? checkCompatibility(descriptor, hardwareProfile)
                        : null
                    }
                  />
                ),
              )}
            </div>
          </div>
        )}

        {/* Ultra-Light Section */}
        {LOCAL_MODELS.some((m) => m.tier === "ultra-light") && (
          <div className="mb-6">
            <h2 className="text-[12px] font-semibold text-muted-foreground uppercase mb-3">
              Ultra-Light
            </h2>
            <div className="space-y-3">
              {LOCAL_MODELS.filter((m) => m.tier === "ultra-light").map(
                (descriptor) => (
                  <ModelCard
                    key={descriptor.modelId}
                    descriptor={descriptor}
                    isCurrent={currentModelId === descriptor.modelId}
                    isPendingSwitch={pendingSwitchId === descriptor.modelId}
                    isConfirmDelete={confirmDeleteId === descriptor.modelId}
                    cacheStatus={cacheStatus.get(descriptor.modelId)}
                    onSelectModel={handleSelectModel}
                    onDelete={() => {
                      setConfirmDeleteId(descriptor.modelId);
                      setDeleteError(null);
                    }}
                    onConfirmDelete={() => handleDelete(descriptor.modelId)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    isLoading={isLoading}
                    isSwitching={isSwitching}
                    isDeleting={isDeleting}
                    deleteError={deleteError}
                    loadedModel={loadedModel}
                    isRecommended={descriptor.modelId === recommendedModelId}
                    compatibilityIssue={
                      selectedModelId === descriptor.modelId
                        ? checkCompatibility(descriptor, hardwareProfile)
                        : null
                    }
                  />
                ),
              )}
            </div>
          </div>
        )}

        {/* Cloud Models Section */}
        <div className="mb-6">
          <h2 className="text-[12px] font-semibold text-muted-foreground uppercase mb-3">
            Cloud Models
          </h2>
          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-medium text-foreground">
                    Use Cloud LLM
                  </h3>
                  <span className="inline-flex items-center rounded-full bg-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-blue shrink-0">
                    OpenAI
                  </span>
                  <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/80 shrink-0">
                    Anthropic · Mistral · Google (coming soon)
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                  Connect to GPT-4o, GPT-4o Mini, and other cloud models with
                  your own API key. Keys are sent per request and never stored.
                </p>
              </div>
              <button
                onClick={onSwitchToCloud}
                disabled={!onSwitchToCloud}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {onSwitchToCloud ? "Connect" : "Open in Local panel"}
              </button>
            </div>
          </div>
        </div>

        {/* Switch Confirmation */}
        {pendingSwitchId && (
          <div className="mb-6 rounded-lg border border-warning/20 bg-warning/5 p-3">
            <p className="text-[12px] text-warning font-medium mb-1">
              Switch models?
            </p>
            <p className="text-[11px] text-muted-foreground mb-3">
              Switching will clear your current conversation with{" "}
              {currentModelId
                ? getModelDescriptor(currentModelId)?.displayName
                : "the current model"}
              . The new model (
              {pendingSwitchId
                ? getModelDescriptor(pendingSwitchId)?.displayName
                : "the new model"}
              ) will start fresh.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmSwitch}
                disabled={isSwitching}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-warning text-white hover:bg-warning/90 transition-colors disabled:opacity-50"
              >
                {isSwitching ? "Switching…" : "Switch & Clear"}
              </button>
              <button
                onClick={() => setPendingSwitchId(null)}
                disabled={isSwitching}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer - Storage Info */}
      {totalCached > 0 && (
        <footer className="flex-shrink-0 p-2 border-t border-border bg-background">
          <div className="flex items-center justify-between gap-4 w-full">
            <div className="text-[11px] text-muted-foreground">
              <span className="font-medium">
                {totalCached} model{totalCached !== 1 ? "s" : ""} cached
              </span>
              <span className="mx-2">·</span>
              <span>{totalCachedSize.toFixed(2)} GB</span>
            </div>
            <ModelFooterIndicator
              modelId={currentModelId}
              onOpenSettings={() => {}}
              isLoading={isLoading}
            />
          </div>
        </footer>
      )}
    </div>
  );
}

interface ModelCardProps {
  descriptor: (typeof LOCAL_MODELS)[number];
  isCurrent: boolean;
  isPendingSwitch: boolean;
  isConfirmDelete: boolean;
  cacheStatus: ModelCacheStatus | undefined;
  onSelectModel: (modelId: DomainModelId) => Promise<void>;
  onDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
  isLoading: boolean;
  isSwitching: boolean;
  isDeleting: boolean;
  deleteError: string | null;
  loadedModel: ModelMetadata | null;
  isRecommended?: boolean;
  compatibilityIssue?: { reason: string; severity: "warning" | "error" } | null;
}

function ModelCard({
  descriptor,
  isCurrent,
  isPendingSwitch,
  isConfirmDelete,
  cacheStatus,
  onSelectModel,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  isLoading,
  isSwitching,
  isDeleting,
  deleteError,
  loadedModel,
  isRecommended = false,
  compatibilityIssue = null,
}: ModelCardProps) {
  return (
    <div
      className={[
        "rounded-xl border p-4 transition-all",
        isConfirmDelete
          ? "border-destructive/40 bg-destructive/5"
          : isCurrent
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-muted/20 hover:bg-muted/30",
      ].join(" ")}
    >
      {isConfirmDelete ? (
        <div>
          <p className="text-[12px] text-destructive font-medium mb-1.5">
            Delete {descriptor.displayName}?
          </p>
          <p className="text-[11px] text-muted-foreground mb-3">
            This will free ~{descriptor.downloadSizeGB} GB and remove the model
            from your device. It will need to be re-downloaded if you want to
            use it again.
          </p>
          {deleteError && (
            <p className="text-[11px] text-destructive mb-2">{deleteError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onConfirmDelete}
              disabled={isLoading || isDeleting}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              {isDeleting ? "Deleting…" : "Confirm Delete"}
            </button>
            <button
              onClick={onCancelDelete}
              disabled={isDeleting}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-medium text-foreground truncate">
                {descriptor.displayName}
              </h3>
              {isCurrent && (
                <span className="inline-flex items-center rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success shrink-0">
                  Active
                </span>
              )}
              {isRecommended && (
                <span className="inline-flex items-center rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent shrink-0">
                  ✨ Recommended
                </span>
              )}
              {cacheStatus?.isCached && (
                <span className="inline-flex items-center rounded-full bg-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-blue shrink-0">
                  Cached
                </span>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
              {descriptor.description}
            </p>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground/80">
              <span>~{descriptor.downloadSizeGB} GB</span>
              <span>·</span>
              <span>~{descriptor.vramRequiredMB} MB VRAM</span>
              <span>·</span>
              <span>
                {"★".repeat(descriptor.codingRating)}
                {"☆".repeat(5 - descriptor.codingRating)}
              </span>
              {isCurrent && loadedModel && (
                <>
                  <span>·</span>
                  <span>{loadedModel.contextLength.toLocaleString()} ctx</span>
                </>
              )}
            </div>
            {compatibilityIssue && (
              <div
                className={`mt-2 text-[11px] font-medium ${
                  compatibilityIssue.severity === "error"
                    ? "text-destructive"
                    : "text-warning"
                }`}
              >
                ⚠️ {compatibilityIssue.reason}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {cacheStatus && (cacheStatus.isCached || isCurrent) && (
              <button
                onClick={onDelete}
                disabled={isLoading || isDeleting}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                title="Delete cached model"
              >
                Delete
              </button>
            )}
            <button
              onClick={() => onSelectModel(descriptor.modelId)}
              disabled={isLoading || isSwitching || isCurrent}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {isSwitching && isPendingSwitch
                ? "Switching…"
                : isCurrent
                  ? "Active"
                  : cacheStatus?.isCached
                    ? "Switch"
                    : "Download"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
