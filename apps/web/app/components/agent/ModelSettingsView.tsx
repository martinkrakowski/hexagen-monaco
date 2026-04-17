"use client";

import { useState, useEffect } from "react";
import { LOCAL_MODELS, getModelDescriptor } from "@/config/models";
import type { ModelMetadata } from "@hexagen/local-llm";
import { ArrowLeft } from "lucide-react";

interface ModelSettingsViewProps {
  currentModelId: string | null;
  loadedModel: ModelMetadata | null;
  messagesLength: number;
  onSwitchModel: (modelId: string) => Promise<void>;
  onDeleteModel: (modelId: string) => Promise<void>;
  hasModelInCache: (modelId: string) => Promise<boolean>;
  onBack: () => void;
  isLoading: boolean;
}

interface ModelCacheStatus {
  modelId: string;
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
}: ModelSettingsViewProps) {
  const [cacheStatus, setCacheStatus] = useState<Map<string, ModelCacheStatus>>(
    new Map(),
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Query cache status for all models on mount
  useEffect(() => {
    const queryCacheStatus = async () => {
      const newStatus = new Map<string, ModelCacheStatus>();
      for (const model of LOCAL_MODELS) {
        newStatus.set(model.id, {
          modelId: model.id,
          isCached: false,
          isChecking: true,
        });
      }
      setCacheStatus(newStatus);

      // Query in parallel
      const results = await Promise.all(
        LOCAL_MODELS.map(async (model) => {
          try {
            const isCached = await hasModelInCache(model.id);
            return {
              modelId: model.id,
              isCached,
            };
          } catch {
            // If query fails, assume not cached
            return {
              modelId: model.id,
              isCached: false,
            };
          }
        }),
      );

      const finalStatus = new Map<string, ModelCacheStatus>();
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

  const handleSelectModel = async (modelId: string) => {
    if (modelId === currentModelId) {
      return;
    }

    if (messagesLength > 0) {
      setPendingSwitchId(modelId);
      return;
    }

    await doSwitch(modelId);
  };

  const doSwitch = async (modelId: string) => {
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

  const handleDelete = async (modelId: string) => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("Delete operation timed out")),
          10000,
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
    if (cacheStatus.get(model.id)?.isCached) {
      return sum + model.downloadSizeGB;
    }
    return sum;
  }, 0);

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onBack}
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground/80 hover:bg-muted/60 transition-colors"
              title="Back to governance"
            >
              <ArrowLeft size={14} />
            </button>
            <h1 className="text-[15px] font-semibold text-foreground tracking-tight">
              AI Model Settings
            </h1>
          </div>
        </div>
        <p className="text-xs text-muted-foreground font-normal pl-[38px]">
          Select and manage local models
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5">
        {/* Current Model Section */}
        {currentModelId && (
          <div className="mb-6">
            <h2 className="text-[12px] font-semibold text-muted-foreground uppercase mb-3">
              Current Model
            </h2>
            {LOCAL_MODELS.find((m) => m.id === currentModelId) && (
              <ModelCard
                descriptor={LOCAL_MODELS.find((m) => m.id === currentModelId)!}
                isCurrent={true}
                isPendingSwitch={false}
                isConfirmDelete={false}
                cacheStatus={cacheStatus.get(currentModelId)}
                onSelectModel={handleSelectModel}
                onDelete={() => {
                  setConfirmDeleteId(currentModelId);
                  setDeleteError(null);
                }}
                onConfirmDelete={() => handleDelete(currentModelId)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                isLoading={isLoading}
                isSwitching={isSwitching}
                isDeleting={isDeleting}
                deleteError={deleteError}
                loadedModel={loadedModel}
              />
            )}
          </div>
        )}

        {/* Available Models Section */}
        {LOCAL_MODELS.filter((m) => m.id !== currentModelId).length > 0 && (
          <div className="mb-6">
            <h2 className="text-[12px] font-semibold text-muted-foreground uppercase mb-3">
              Available Models
            </h2>
            <div className="space-y-3">
              {LOCAL_MODELS.filter((m) => m.id !== currentModelId).map(
                (descriptor) => (
                  <ModelCard
                    key={descriptor.id}
                    descriptor={descriptor}
                    isCurrent={false}
                    isPendingSwitch={pendingSwitchId === descriptor.id}
                    isConfirmDelete={confirmDeleteId === descriptor.id}
                    cacheStatus={cacheStatus.get(descriptor.id)}
                    onSelectModel={handleSelectModel}
                    onDelete={() => {
                      setConfirmDeleteId(descriptor.id);
                      setDeleteError(null);
                    }}
                    onConfirmDelete={() => handleDelete(descriptor.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    isLoading={isLoading}
                    isSwitching={isSwitching}
                    isDeleting={isDeleting}
                    deleteError={deleteError}
                    loadedModel={loadedModel}
                  />
                ),
              )}
            </div>
          </div>
        )}

        {/* Switch Confirmation */}
        {pendingSwitchId && (
          <div className="mb-6 rounded-lg border border-warning/20 bg-warning/5 p-3">
            <p className="text-[12px] text-warning font-medium mb-1">
              Switch models?
            </p>
            <p className="text-[11px] text-muted-foreground mb-3">
              Switching will clear your current conversation with{" "}
              {getModelDescriptor(currentModelId ?? "")?.displayName ??
                "the current model"}
              . The new model (
              {getModelDescriptor(pendingSwitchId)?.displayName}) will start
              fresh.
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

        {/* Storage Info */}
        {totalCached > 0 && (
          <div className="mt-6 rounded-lg border border-border bg-muted/20 p-4">
            <h3 className="text-[12px] font-semibold text-foreground mb-2">
              Storage Info
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {totalCached} model{totalCached !== 1 ? "s" : ""} cached (
              {totalCachedSize.toFixed(2)} GB)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface ModelCardProps {
  descriptor: (typeof LOCAL_MODELS)[number];
  isCurrent: boolean;
  isPendingSwitch: boolean;
  isConfirmDelete: boolean;
  cacheStatus: ModelCacheStatus | undefined;
  onSelectModel: (modelId: string) => Promise<void>;
  onDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
  isLoading: boolean;
  isSwitching: boolean;
  isDeleting: boolean;
  deleteError: string | null;
  loadedModel: ModelMetadata | null;
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
}: ModelCardProps) {
  return (
    <div>
      <div
        className={[
          "rounded-xl border p-4 transition-all",
          isCurrent
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-muted/20 hover:bg-muted/30",
        ].join(" ")}
      >
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
              {isCurrent && loadedModel && (
                <>
                  <span>·</span>
                  <span>{loadedModel.contextLength.toLocaleString()} ctx</span>
                </>
              )}
            </div>
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
              onClick={() => onSelectModel(descriptor.id)}
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
      </div>

      {isConfirmDelete && (
        <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-[12px] text-destructive font-medium mb-2">
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
              {isDeleting ? "Deleting…" : "Delete"}
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
      )}
    </div>
  );
}
