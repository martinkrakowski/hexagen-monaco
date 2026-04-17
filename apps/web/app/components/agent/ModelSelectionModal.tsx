"use client";

import { useState } from "react";
import { LOCAL_MODELS, getModelDescriptor } from "@/config/models";
import type { ModelMetadata } from "@hexagen/local-llm";
import { X } from "lucide-react";

interface ModelSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModelId: string | null;
  onSelectModel: (modelId: string) => Promise<void>;
  onDeleteModel: (modelId: string) => Promise<void>;
  loadedModel: ModelMetadata | null;
  isLoading: boolean;
  messagesLength: number;
}

export function ModelSelectionModal({
  isOpen,
  onClose,
  currentModelId,
  onSelectModel,
  onDeleteModel,
  loadedModel,
  isLoading,
  messagesLength,
}: ModelSelectionModalProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectModel = async (modelId: string) => {
    if (modelId === currentModelId) {
      onClose();
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
      await onSelectModel(modelId);
      onClose();
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
      if (modelId === currentModelId) {
        onClose();
      }
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete model",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bg-card rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Select AI Model
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Local models run entirely in your browser
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-3 max-h-[360px] overflow-y-auto">
            {LOCAL_MODELS.map((descriptor) => {
              const isCurrent = descriptor.id === currentModelId;
              const isPendingSwitch = pendingSwitchId === descriptor.id;
              const isConfirmDelete = confirmDeleteId === descriptor.id;

              return (
                <div key={descriptor.id}>
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
                        </div>
                        <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                          {descriptor.description}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground/80">
                          <span>~{descriptor.downloadSizeGB} GB</span>
                          <span>·</span>
                          <span>~{descriptor.vramRequiredMB} MB VRAM</span>
                          {descriptor.id === currentModelId && loadedModel && (
                            <>
                              <span>·</span>
                              <span>
                                {loadedModel.contextLength.toLocaleString()} ctx
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {isCurrent ? (
                          <button
                            onClick={() => {
                              setConfirmDeleteId(descriptor.id);
                              setDeleteError(null);
                            }}
                            disabled={isLoading || isDeleting}
                            className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSelectModel(descriptor.id)}
                            disabled={isLoading || isSwitching}
                            className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                          >
                            {isSwitching && isPendingSwitch
                              ? "Switching…"
                              : "Switch"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isConfirmDelete && (
                    <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                      <p className="text-[12px] text-destructive font-medium mb-2">
                        Delete {descriptor.displayName}?
                      </p>
                      <p className="text-[11px] text-muted-foreground mb-3">
                        This will free ~{descriptor.downloadSizeGB} GB and
                        remove the model from your device. It will need to be
                        re-downloaded if you want to use it again.
                      </p>
                      {deleteError && (
                        <p className="text-[11px] text-destructive mb-2">
                          {deleteError}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDelete(descriptor.id)}
                          disabled={isLoading || isDeleting}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50"
                        >
                          {isDeleting ? "Deleting…" : "Delete"}
                        </button>
                        <button
                          onClick={() => {
                            setConfirmDeleteId(null);
                            setDeleteError(null);
                          }}
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
            })}
          </div>

          {pendingSwitchId && (
            <div className="mx-5 mb-5 rounded-lg border border-warning/20 bg-warning/5 p-3">
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
        </div>
      </div>
    </>
  );
}
