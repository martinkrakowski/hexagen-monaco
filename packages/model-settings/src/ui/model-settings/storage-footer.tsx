import { useState, memo } from "react";
import type { DomainModelId } from "@hexagen/local-llm/client";
import { ModelFooterIndicator } from "../ModelFooterIndicator";

interface StorageFooterProps {
  totalCached: number;
  totalCachedSize: number;
  currentModelId: DomainModelId | null;
  isLoading: boolean;
  onResetConfig?: () => void;
}

function StorageFooterComponent({
  totalCached,
  totalCachedSize,
  currentModelId,
  isLoading,
  onResetConfig,
}: StorageFooterProps) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleConfirmReset = () => {
    setShowResetConfirm(false);
    onResetConfig?.();
  };

  if (totalCached <= 0 && !onResetConfig) return null;

  return (
    <footer className="flex-shrink-0 p-2 border-t border-border bg-background">
      <div className="flex items-center justify-between gap-4 w-full">
        {totalCached > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">
              {totalCached} model{totalCached !== 1 ? "s" : ""} cached
            </span>
            <span className="mx-2">·</span>
            <span>{totalCachedSize.toFixed(2)} GB</span>
          </div>
        )}
        {totalCached <= 0 && <div />}
        <div className="flex items-center gap-2">
          {onResetConfig && (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="text-xs text-red-500 hover:text-red-400 transition-colors px-2 py-1 rounded"
            >
              Reset Local AI Config
            </button>
          )}
          <ModelFooterIndicator
            modelId={currentModelId}
            onOpenSettings={() => {}}
            isLoading={isLoading}
          />
        </div>
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-5 max-w-sm mx-4 shadow-lg">
            <h3 className="text-sm font-semibold text-foreground mb-2">
              Reset Local AI Configuration
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              This will reset your local AI configuration. You will need to
              re-select and download your model. Your cached model weights will
              be preserved.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="text-xs px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-muted/60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="text-xs px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}

export const StorageFooter = memo(StorageFooterComponent);
