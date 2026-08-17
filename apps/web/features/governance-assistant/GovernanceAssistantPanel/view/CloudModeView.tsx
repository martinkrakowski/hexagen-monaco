"use client";

import type { UserSecretVaultPort } from "@hexagen/web-driver";
import { CloudConnectingView } from "./CloudConnectingView";
import { CloudChatView } from "./CloudChatView";
import type { CloudChatMessage, ConnectionState, LLMMode } from "../types";

export interface CloudModeViewProps {
  /**
   * Injected rather than read from context: this half of the panel is
   * presentational, and `CloudModelSettingsView` already takes the vault as a
   * prop. The boundary reads it once from `SecretVaultProvider`.
   */
  vault: UserSecretVaultPort;
  cloudConnectionState: ConnectionState;
  cloudConnectionError: { message: string; retryable: boolean } | null;
  onModeChange: (mode: LLMMode) => void;
  onCloudConnect: (provider: string, model: string) => Promise<void>;
  onCloudDisconnect: () => void;
  onRetryConnection: () => void;
  cloudMessages: CloudChatMessage[];
  cloudLLMStatus: string;
  cloudLLMError: string | null;
  onSendMessage: (content: string) => void;
  onAbort: () => void;
  onClear: () => void;
  modelName: string;
}

export function CloudModeView({
  vault,
  cloudConnectionState,
  cloudConnectionError,
  onModeChange,
  onCloudConnect,
  onCloudDisconnect,
  onRetryConnection,
  cloudMessages,
  cloudLLMStatus,
  cloudLLMError,
  onSendMessage,
  onAbort,
  onClear,
  modelName,
}: CloudModeViewProps) {
  if (cloudConnectionState !== "connected") {
    return (
      <CloudConnectingView
        vault={vault}
        onModeChange={onModeChange}
        onCloudConnect={onCloudConnect}
        isConnecting={cloudConnectionState === "connecting"}
        connectionError={cloudConnectionError}
        onRetryConnection={onRetryConnection}
      />
    );
  }

  return (
    <CloudChatView
      onModeChange={onModeChange}
      cloudMessages={cloudMessages}
      cloudLLMStatus={cloudLLMStatus}
      cloudLLMError={cloudLLMError}
      onSendMessage={onSendMessage}
      onAbort={onAbort}
      onClear={onClear}
      onDisconnect={onCloudDisconnect}
      modelName={modelName}
    />
  );
}
