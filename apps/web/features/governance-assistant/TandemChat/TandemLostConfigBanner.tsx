"use client";

import { X } from "lucide-react";

export interface TandemLostConfigBannerProps {
  onDismiss: () => void;
  onOpenSettings: () => void;
}

export function TandemLostConfigBanner({
  onDismiss,
  onOpenSettings,
}: TandemLostConfigBannerProps) {
  return (
    <div
      role="status"
      className="mx-4 mb-3 px-3 py-2 rounded-md bg-warning/10 border border-warning/20 dark:bg-warning/20 dark:border-warning/30 flex items-start gap-2"
    >
      <p className="text-xs text-warning-foreground dark:text-warning flex-1">
        Your Tandem Mode configuration was reset, possibly due to browser data
        being cleared. Reconfigure in Settings.{" "}
        <button
          type="button"
          onClick={onOpenSettings}
          className="underline underline-offset-2 hover:no-underline transition-all"
        >
          Configure in Settings
        </button>
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
