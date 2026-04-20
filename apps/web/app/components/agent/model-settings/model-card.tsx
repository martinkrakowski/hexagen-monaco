import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm";

export type ModelCardStatus =
  | { status: "default" }
  | { status: "pending-switch" }
  | { status: "confirm-delete" };

interface ModelCardProps {
  descriptor: {
    modelId: DomainModelId;
    displayName: string;
    description: string;
    downloadSizeGB: number;
    vramRequiredMB: number;
    codingRating: number;
  };
  isCurrent: boolean;
  cardStatus: ModelCardStatus;
  cacheStatus: { isCached: boolean; isChecking: boolean } | undefined;
  onSelectModel: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
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
}

export function ModelCard({
  descriptor,
  isCurrent,
  cardStatus,
  cacheStatus,
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
  isRecommended = false,
  compatibilityIssue = null,
}: ModelCardProps) {
  const isPendingSwitch = cardStatus.status === "pending-switch";
  const isConfirmDelete = cardStatus.status === "confirm-delete";

  const borderClass = isConfirmDelete
    ? "border-destructive/40 bg-destructive/5"
    : isPendingSwitch
      ? "border-warning/20 bg-warning/5"
      : isCurrent
        ? "border-primary/40 bg-primary/5"
        : "border-border bg-muted/20 hover:bg-muted/30";

  const buttonDisabled = isLoading || isSwitching || isDeleting;

  if (isConfirmDelete) {
    return (
      <div className={`rounded-xl border p-4 transition-all ${borderClass}`}>
        <p className="text-[12px] text-destructive font-medium mb-1.5">
          Delete {descriptor.displayName}?
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          This will free ~{descriptor.downloadSizeGB} GB and remove the model
          from your device. It will need to be re-downloaded if you want to use
          it again.
        </p>
        {error && <p className="text-xs text-destructive mb-2">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onConfirmDelete}
            disabled={buttonDisabled}
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
    );
  }

  if (isPendingSwitch) {
    return (
      <div className={`rounded-xl border p-4 transition-all ${borderClass}`}>
        <p className="text-[12px] text-warning font-medium mb-1">
          Switch models?
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Switching will clear your current conversation with{" "}
          {currentModelDisplayName ?? "the current model"}. The new model (
          {descriptor.displayName}) will start fresh.
        </p>
        {error && <p className="text-xs text-destructive mb-2">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onConfirmSwitch}
            disabled={buttonDisabled}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-warning text-white hover:bg-warning/90 transition-colors disabled:opacity-50"
          >
            {isSwitching ? "Switching…" : "Switch & Clear"}
          </button>
          <button
            onClick={onCancelSwitch}
            disabled={isSwitching}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-4 transition-all ${borderClass}`}>
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
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/80">
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
              className={`mt-2 text-xs font-medium ${
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
            onClick={onSelectModel}
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
  );
}
