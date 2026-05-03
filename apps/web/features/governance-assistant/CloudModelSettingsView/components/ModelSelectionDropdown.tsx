import React from "react";
import type { ClientProvider, ClientModel } from "../types";

interface ModelSelectionDropdownProps {
  providers: ClientProvider[];
  selectedProvider: string;
  selectedModel: string;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
}

export function ModelSelectionDropdown({
  providers,
  selectedProvider,
  selectedModel,
  onProviderChange,
  onModelChange,
  disabled = false,
}: ModelSelectionDropdownProps) {
  const currentProvider = providers.find((p) => p.id === selectedProvider);
  const availableModels: ClientModel[] =
    currentProvider?.models.filter((m) => {
      if (!currentProvider.available) return false;
      return m.available;
    }) ?? [];

  return (
    <div className="space-y-3">
      <select
        value={selectedProvider}
        onChange={(e) => onProviderChange(e.target.value)}
        disabled={disabled}
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
      >
        <option value="">Select provider</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.available}>
            {p.displayName}
            {!p.available ? " (Coming soon)" : ""}
          </option>
        ))}
      </select>

      {selectedProvider && (
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={disabled}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
        >
          <option value="">Select model</option>
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
