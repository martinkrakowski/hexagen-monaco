"use client";

import { useEffect, useCallback } from "react";
import { getClientProviders } from "@hexagen/local-llm";
import {
  CloudSettingsHeader,
  SettingsForm,
  ConnectionStatus,
  ActionButtons,
} from "./components";
import { useCloudModelSettings, useCloudConnectivity } from "./hooks";
import type { CloudModelSettingsViewProps } from "./types";
import { withTimeout } from "./utils/withTimeout";

export function CloudModelSettingsView({
  vault,
  onConnect,
  isConnecting,
  isConnected,
  connectionError,
  onRetry,
  onCancelConnection,
}: CloudModelSettingsViewProps) {
  const settings = useCloudModelSettings({ vault });
  const connectivity = useCloudConnectivity(isConnecting, connectionError, isConnected);

  const clientProviders = getClientProviders();
  const {
    state,
    setProvider,
    setModel,
    setApiKey,
    setRememberKey,
    setStoring,
    saveSettings,
  } = settings;
  const {
    selectedProvider,
    selectedModel,
    apiKey,
    rememberKey,
    isStoring,
    loadingSettings,
  } = state;

  // Clear local error when user modifies form fields
  useEffect(() => {
    connectivity.clearError();
  }, [apiKey, selectedProvider, selectedModel, connectivity]);

  const canConnect =
    selectedProvider &&
    selectedModel &&
    apiKey.trim().length > 0 &&
    !isConnecting &&
    !isStoring &&
    !loadingSettings;

  const handleConnect = useCallback(async () => {
    if (!canConnect) return;

    connectivity.clearError();
    setStoring(true);

    try {
      // Save settings to vault first
      const saveResult = await withTimeout(
        saveSettings(),
        5000,
        "Vault operation timed out. Please try again.",
      );

      if (!saveResult.ok) {
        const errorMsg = saveResult.error || "Failed to save API key.";
        connectivity.setError(errorMsg);
        setStoring(false);
        return;
      }

      console.log(
        "[CloudModelSettingsView] Settings saved, connecting to cloud provider",
      );

      // Connect to cloud provider
      await withTimeout(
        onConnect(selectedProvider, selectedModel),
        15000,
        "Connection timed out. Please try again.",
      );

      // Clear form on successful connection
      setProvider("");
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Connection failed.";
      console.error("[CloudModelSettingsView] Connection error:", errorMsg);
      connectivity.setError(errorMsg);
    } finally {
      setStoring(false);
    }
  }, [
    canConnect,
    setStoring,
    saveSettings,
    connectivity,
    onConnect,
    selectedProvider,
    selectedModel,
    setProvider,
  ]);

  // Show loading state while retrieving settings from vault
  if (loadingSettings) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
        <CloudSettingsHeader />
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span>Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
      <CloudSettingsHeader />

      <SettingsForm
        providers={clientProviders}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        apiKey={apiKey}
        rememberKey={rememberKey}
        disabled={isStoring || isConnecting}
        onProviderChange={setProvider}
        onModelChange={setModel}
        onApiKeyChange={setApiKey}
        onRememberKeyChange={setRememberKey}
      />

      <ConnectionStatus
        connected={connectivity.isConnected}
        loading={isConnecting ?? false}
        error={connectivity.state.error}
        onRetry={onRetry}
      />

      <ActionButtons
        canConnect={!!canConnect}
        isConnecting={isConnecting ?? false}
        isStoring={isStoring}
        showConnectionError={!!connectionError}
        onConnect={handleConnect}
        onCancel={onCancelConnection}
      />
    </div>
  );
}
