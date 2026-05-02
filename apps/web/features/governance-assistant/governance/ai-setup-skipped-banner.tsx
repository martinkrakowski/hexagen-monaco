"use client";

import { X } from "lucide-react";

interface Props {
  onDismiss: () => void;
}

export function AiSetupSkippedBanner({ onDismiss }: Props) {
  return (
    <div className="mx-4 mb-3 px-3 py-2 rounded-md bg-warning/10 border border-warning/20 flex items-start gap-2">
      <p className="text-xs text-warning-foreground flex-1">
        AI was not configured during setup. Configure a model here to enable governance features.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
