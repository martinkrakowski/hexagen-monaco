import React from "react";

interface ActionButtonsProps {
  canConnect: boolean;
  isConnecting: boolean;
  isStoring: boolean;
  showConnectionError: boolean;
  onConnect: () => void;
  onCancel?: () => void;
  onTestConnection?: () => void;
}

export function ActionButtons({
  canConnect,
  isConnecting,
  isStoring,
  showConnectionError,
  onConnect,
  onCancel,
  onTestConnection,
}: ActionButtonsProps) {
  const isLoading = isConnecting || isStoring;

  return (
    <div className="w-full max-w-xs space-y-2">
      {!showConnectionError && (
        <button
          type="button"
          onClick={onConnect}
          disabled={!canConnect}
          className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isStoring
            ? "Storing key..."
            : isConnecting
              ? "Connecting..."
              : "Connect"}
        </button>
      )}

      {onTestConnection && !isLoading && !showConnectionError && (
        <button
          type="button"
          onClick={onTestConnection}
          className="w-full h-9 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        >
          Test Connection
        </button>
      )}

      {isConnecting && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full h-9 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
