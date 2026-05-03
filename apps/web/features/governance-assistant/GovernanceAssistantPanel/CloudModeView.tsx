"use client";

import { CloudConnectingView } from "./CloudConnectingView";
import { CloudChatView } from "./CloudChatView";
import type { ModeWrapperProps } from "./types";

type CloudModeViewProps = Pick<
  ModeWrapperProps,
  | "cloudConnectionState"
  | "cloudConnectionError"
  | "onModeChange"
  | "onCloudConnect"
  | "onCloudDisconnect"
  | "onRetryConnection"
  | "cloudMessages"
  | "cloudLLMStatus"
  | "cloudLLMError"
  | "onSendMessage"
  | "onAbort"
  | "onClear"
  | "modelName"
>;

export function CloudModeView({
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
