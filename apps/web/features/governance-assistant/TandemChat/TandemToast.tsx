"use client";

import { useEffect } from "react";

export interface TandemToastProps {
  message: string;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function TandemToast({
  message,
  onDismiss,
  autoDismissMs = 5000,
}: TandemToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [onDismiss, autoDismissMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-card border border-border rounded-lg shadow-lg px-4 py-3 max-w-sm"
    >
      <p className="flex-1 text-sm">{message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground ml-1"
      >
        &times;
      </button>
    </div>
  );
}
