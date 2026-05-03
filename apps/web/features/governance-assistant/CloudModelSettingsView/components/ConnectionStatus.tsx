import React from "react";

interface ConnectionStatusProps {
  connected: boolean;
  loading: boolean;
  error?: string;
  onRetry?: () => void;
}

export function ConnectionStatus({
  connected,
  loading,
  error,
  onRetry,
}: ConnectionStatusProps) {
  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive text-center">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="w-full h-9 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            Retry Connection
          </button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <span>Connecting...</span>
      </div>
    );
  }

  if (connected) {
    return (
      <div className="flex items-center justify-center gap-2 text-xs text-green-600">
        <div className="h-2 w-2 rounded-full bg-green-600" />
        <span>Connected</span>
      </div>
    );
  }

  return null;
}
