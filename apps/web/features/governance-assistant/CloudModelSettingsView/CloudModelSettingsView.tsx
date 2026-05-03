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
  connectionError,
  onRetry,
  onCancelConnection,
}: CloudModelSettingsViewProps) {
  const settings = useCloudModelSettings();
  const connectivity = useCloudConnectivity(isConnecting, connectionError);

  const clientProviders = getClientProviders();
  const {
    state,
    setProvider,
    setModel,
    setApiKey,
    setRememberKey,
    setStoring,
  } = settings;
  const { selectedProvider, selectedModel, apiKey, rememberKey, isStoring } =
    state;

  // Clear store error when user modifies form fields
  useEffect(() => {
    connectivity.clearError();
  }, [apiKey, selectedProvider, selectedModel, connectivity]);

  const canConnect =
    selectedProvider &&
    selectedModel &&
    apiKey.trim().length > 0 &&
    !isConnecting &&
    !isStoring;

  const handleConnect = useCallback(async () => {
    if (!canConnect) return;

    connectivity.clearError();
    setStoring(true);
    try {
      const storeResult = await withTimeout(
        vault.store(apiKey, rememberKey),
        5000,
        "Vault operation timed out. Please try again.",
      );
      if (!storeResult.success) {
        const errorMsg =
          storeResult.error?.message || "Failed to store API key.";
        connectivity.setError(errorMsg);
        setStoring(false);
        return;
      }

      await withTimeout(
        onConnect(selectedProvider, selectedModel),
        15000,
        "Connection timed out. Please try again.",
      );

      setProvider("");
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Connection failed.";
      connectivity.setError(errorMsg);
    } finally {
      setStoring(false);
    }
  }, [
    vault,
    apiKey,
    rememberKey,
    selectedProvider,
    selectedModel,
    onConnect,
    canConnect,
    setStoring,
    setProvider,
    connectivity,
  ]);

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
