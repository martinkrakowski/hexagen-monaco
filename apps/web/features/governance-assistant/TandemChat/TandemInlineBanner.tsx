"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export interface TandemInlineBannerProps {
  variant: "warning" | "error";
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  retryLabel?: string;
  /** If provided, the banner auto-dismisses after this many milliseconds. Requires onDismiss. */
  autoDismissMs?: number;
}

export function TandemInlineBanner({
  variant,
  message,
  onDismiss,
  onRetry,
  retryLabel = "Retry",
  autoDismissMs,
}: TandemInlineBannerProps) {
  useEffect(() => {
    if (autoDismissMs === undefined || onDismiss === undefined) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);
  const isError = variant === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "mx-4 mb-3 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 dark:bg-destructive/20 dark:border-destructive/30 flex items-start gap-2"
          : "mx-4 mb-3 px-3 py-2 rounded-md bg-warning/10 border border-warning/20 dark:bg-warning/20 dark:border-warning/30 flex items-start gap-2"
      }
    >
      <p
        className={`text-xs flex-1 ${
          isError
            ? "text-destructive dark:text-destructive-foreground"
            : "text-warning-foreground dark:text-warning"
        }`}
      >
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 text-xs font-medium underline text-muted-foreground hover:text-foreground transition-colors"
        >
          {retryLabel}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
