"use client";

import { useState, useCallback } from "react";
import { getClientProviders } from "@/config/cloud-providers";
import type { SecretVaultPort } from "@hexagen/agentic-interaction";

interface CloudModelSettingsViewProps {
  vault: SecretVaultPort;
  onConnect: (provider: string, model: string) => Promise<void>;
  isConnecting?: boolean;
  error?: string | null;
}

export function CloudModelSettingsView({
  vault,
  onConnect,
  isConnecting,
  error,
}: CloudModelSettingsViewProps) {
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [isStoring, setIsStoring] = useState(false);

  const clientProviders = getClientProviders();
  const currentProvider = clientProviders.find(
    (p) => p.id === selectedProvider,
  );
  const availableModels =
    currentProvider?.models.filter((m) => {
      if (!currentProvider.available) return false;
      return m.available;
    }) ?? [];

  const canConnect =
    selectedProvider &&
    selectedModel &&
    apiKey.trim().length > 0 &&
    !isConnecting &&
    !isStoring;

  const handleConnect = useCallback(async () => {
    if (!canConnect) return;

    setIsStoring(true);
    try {
      // Store the API key in the vault with persistence preference
      const storeResult = await vault.store(apiKey, rememberKey);
      if (!storeResult.success) {
        return;
      }

      // Key successfully stored in vault
      // Now invoke the orchestrator callback with just provider and model
      // The API key will be retrieved from vault when needed
      await onConnect(selectedProvider, selectedModel);

      // Clear the form after successful connection
      setApiKey("");
      setSelectedProvider("");
      setSelectedModel("");
      setRememberKey(false);
    } finally {
      setIsStoring(false);
    }
  }, [
    vault,
    apiKey,
    rememberKey,
    selectedProvider,
    selectedModel,
    onConnect,
    canConnect,
  ]);

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
        <svg
          className="h-6 w-6 text-primary"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      </div>

      <div className="text-center space-y-1">
        <h3 className="text-sm font-semibold">Connect to Cloud LLM</h3>
        <p className="text-xs text-muted-foreground">
          Your API key is sent with each request and never stored on our
          servers.
        </p>
      </div>

      <div className="w-full max-w-xs space-y-3">
        <select
          value={selectedProvider}
          onChange={(e) => {
            setSelectedProvider(e.target.value);
            setSelectedModel("");
          }}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Select provider</option>
          {clientProviders.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.available}>
              {p.displayName}
              {!p.available ? " (Coming soon)" : ""}
            </option>
          ))}
        </select>

        {selectedProvider && (
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select model</option>
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        )}

        {selectedProvider && (
          <input
            type="password"
            placeholder="API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={isStoring}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
          />
        )}

        {selectedProvider && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(e) => setRememberKey(e.target.checked)}
              disabled={isStoring}
              className="w-4 h-4 rounded border border-input"
            />
            <span>Remember this key securely (survives page refresh)</span>
          </label>
        )}

        {error && (
          <p className="text-xs text-destructive text-center">{error}</p>
        )}

        <button
          type="button"
          onClick={handleConnect}
          disabled={!canConnect}
          className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isStoring
            ? "Storing key..."
            : isConnecting
              ? "Connecting..."
              : "Connect"}
        </button>
      </div>
    </div>
  );
}
