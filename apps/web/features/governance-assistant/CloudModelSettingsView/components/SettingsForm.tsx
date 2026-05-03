import React from "react";
import { ModelSelectionDropdown } from "./ModelSelectionDropdown";
import { ApiKeyInput } from "./ApiKeyInput";
import type { ClientProvider } from "../types";

interface SettingsFormProps {
  providers: ClientProvider[];
  selectedProvider: string;
  selectedModel: string;
  apiKey: string;
  rememberKey: boolean;
  disabled?: boolean;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onRememberKeyChange: (remember: boolean) => void;
}

export function SettingsForm({
  providers,
  selectedProvider,
  selectedModel,
  apiKey,
  rememberKey,
  disabled = false,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onRememberKeyChange,
}: SettingsFormProps) {
  return (
    <form
      className="w-full max-w-xs space-y-3"
      onSubmit={(e) => e.preventDefault()}
    >
      <ModelSelectionDropdown
        providers={providers}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onProviderChange={onProviderChange}
        onModelChange={onModelChange}
        disabled={disabled}
      />

      {selectedProvider && (
        <>
          <ApiKeyInput
            value={apiKey}
            onChange={onApiKeyChange}
            disabled={disabled}
            placeholder="API key"
          />

          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(e) => onRememberKeyChange(e.target.checked)}
              disabled={disabled}
              className="w-4 h-4 rounded border border-input"
            />
            <span>Remember this key securely (survives page refresh)</span>
          </label>
        </>
      )}
    </form>
  );
}
