"use client";

import { useState, useEffect, useReducer, useCallback } from "react";
import { getClientProviders } from "@hexagen/local-llm";
import type { UserSecretVaultPort } from "@hexagen/web-driver";

/**
 * Wrap a promise with a timeout that rejects if not resolved within timeoutMs.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs),
    ),
  ]);
}

interface CloudModelSettingsViewProps {
  vault: UserSecretVaultPort;
  onConnect: (provider: string, model: string) => Promise<void>;
  isConnecting?: boolean;
  connectionError?: string | null;
  onRetry?: () => void;
  onCancelConnection?: () => void;
}

interface CloudFormState {
  selectedProvider: string;
  selectedModel: string;
  apiKey: string;
  rememberKey: boolean;
  isStoring: boolean;
}

type CloudFormAction =
  | { type: "SET_PROVIDER"; payload: string }
  | { type: "SET_MODEL"; payload: string }
  | { type: "SET_API_KEY"; payload: string }
  | { type: "SET_REMEMBER_KEY"; payload: boolean }
  | { type: "SET_STORING"; payload: boolean }
  | { type: "RESET_FORM" };

const initialState: CloudFormState = {
  selectedProvider: "",
  selectedModel: "",
  apiKey: "",
  rememberKey: false,
  isStoring: false,
};

function cloudFormReducer(
  state: CloudFormState,
  action: CloudFormAction,
): CloudFormState {
  switch (action.type) {
    case "SET_PROVIDER":
      return { ...state, selectedProvider: action.payload, selectedModel: "" };
    case "SET_MODEL":
      return { ...state, selectedModel: action.payload };
    case "SET_API_KEY":
      return { ...state, apiKey: action.payload };
    case "SET_REMEMBER_KEY":
      return { ...state, rememberKey: action.payload };
    case "SET_STORING":
      return { ...state, isStoring: action.payload };
    case "RESET_FORM":
      return {
        ...initialState,
        selectedProvider: state.selectedProvider,
        selectedModel: state.selectedModel,
      };
    default:
      return state;
  }
}

export function CloudModelSettingsView({
  vault,
  onConnect,
  isConnecting,
  connectionError,
  onRetry,
  onCancelConnection,
}: CloudModelSettingsViewProps) {
  const [state, dispatch] = useReducer(cloudFormReducer, initialState);
  const { selectedProvider, selectedModel, apiKey, rememberKey, isStoring } =
    state;
  const [storeError, setStoreError] = useState<string | null>(null);

  const clientProviders = getClientProviders();
  const currentProvider = clientProviders.find(
    (p) => p.id === selectedProvider,
  );
  const availableModels =
    currentProvider?.models.filter((m) => {
      if (!currentProvider.available) return false;
      return m.available;
    }) ?? [];

  // Clear storeError when user modifies form fields
  useEffect(() => {
    setStoreError(null);
  }, [apiKey, selectedProvider, selectedModel]);

  const canConnect =
    selectedProvider &&
    selectedModel &&
    apiKey.trim().length > 0 &&
    !isConnecting &&
    !isStoring;

  const handleConnect = useCallback(async () => {
    if (!canConnect) return;

    setStoreError(null);
    dispatch({ type: "SET_STORING", payload: true });
    try {
      const storeResult = await withTimeout(
        vault.store(apiKey, rememberKey),
        5000,
        "Vault operation timed out. Please try again.",
      );
      if (!storeResult.success) {
        const errorMsg =
          storeResult.error?.message || "Failed to store API key.";
        setStoreError(errorMsg);
        dispatch({ type: "SET_STORING", payload: false });
        return;
      }

      await withTimeout(
        onConnect(selectedProvider, selectedModel),
        15000,
        "Connection timed out. Please try again.",
      );

      dispatch({
        type: "SET_PROVIDER",
        payload: "",
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Connection failed.";
      setStoreError(errorMsg);
    } finally {
      dispatch({ type: "SET_STORING", payload: false });
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
            dispatch({ type: "SET_PROVIDER", payload: e.target.value });
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
            onChange={(e) =>
              dispatch({ type: "SET_MODEL", payload: e.target.value })
            }
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
            onChange={(e) =>
              dispatch({ type: "SET_API_KEY", payload: e.target.value })
            }
            disabled={isStoring}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
          />
        )}

        {selectedProvider && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(e) =>
                dispatch({
                  type: "SET_REMEMBER_KEY",
                  payload: e.target.checked,
                })
              }
              disabled={isStoring}
              className="w-4 h-4 rounded border border-input"
            />
            <span>Remember this key securely (survives page refresh)</span>
          </label>
        )}

        {(storeError || connectionError) && (
          <div className="space-y-2">
            <p className="text-xs text-destructive text-center">
              {storeError || connectionError}
            </p>
            {!storeError && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="w-full h-9 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Retry Connection
              </button>
            )}
          </div>
        )}

        {!connectionError && (
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
        )}

        {isConnecting && onCancelConnection && (
          <button
            type="button"
            onClick={onCancelConnection}
            className="w-full h-9 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
