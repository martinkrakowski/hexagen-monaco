"use client";

import { CloudModelSettingsView } from "../CloudModelSettingsView";
import { PanelFooter } from "../governance";
import { useSecretVault } from "@/lib/vault-context";

interface CloudConnectingViewProps {
  onModeChange: (mode: "local" | "cloud") => void;
  onCloudConnect: (provider: string, model: string) => Promise<void>;
  isConnecting: boolean;
  connectionError: { message: string; retryable: boolean } | null;
  onRetryConnection: () => void;
}

export function CloudConnectingView({
  onModeChange,
  onCloudConnect,
  isConnecting,
  connectionError,
  onRetryConnection,
}: CloudConnectingViewProps) {
  const vault = useSecretVault();

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => onModeChange("local")}
          className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Local
        </button>
        <button
          type="button"
          className="flex-1 py-2 text-sm font-medium border-b-2 border-primary text-foreground"
        >
          Cloud
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <CloudModelSettingsView
          vault={vault}
          onConnect={onCloudConnect}
          isConnecting={isConnecting}
          isConnected={false}
          connectionError={connectionError?.message ?? null}
          onRetry={connectionError?.retryable ? onRetryConnection : undefined}
          onCancelConnection={undefined}
        />
      </div>
      <PanelFooter showHint={false} />
    </div>
  );
}
