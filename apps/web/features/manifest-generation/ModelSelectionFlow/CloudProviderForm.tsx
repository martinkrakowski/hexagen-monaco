"use client";

import { useState } from "react";
import { Button, Input, Label, Tabs } from "@hexagen/ui";

interface CloudProviderFormProps {
  onSubmit: (provider: string, apiKey: string) => void;
  onGoBack?: () => void;
  isValidating: boolean;
  provider?: string;
  apiKey?: string;
}

export function CloudProviderForm({
  onSubmit,
  onGoBack,
  isValidating,
  provider = "openai",
  apiKey = "",
}: CloudProviderFormProps) {
  const [selectedProvider, setSelectedProvider] = useState(provider);
  const [keyInput, setKeyInput] = useState(apiKey);
  const [keyError, setKeyError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Basic validation
    if (!keyInput.trim()) {
      setKeyError("API key is required");
      return;
    }

    if (keyInput.length < 5) {
      setKeyError("API key appears to be invalid");
      return;
    }

    setKeyError("");
    onSubmit(selectedProvider, keyInput);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Tabs.Root
        value={selectedProvider}
        onValueChange={setSelectedProvider}
        className="w-full"
      >
        <Tabs.List className="grid grid-cols-3 mb-4">
          <Tabs.Trigger value="openai">OpenAI</Tabs.Trigger>
          <Tabs.Trigger value="anthropic">Anthropic</Tabs.Trigger>
          <Tabs.Trigger value="other">Other</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="openai" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Enter your OpenAI API key to use GPT models for manifest generation.
          </p>
          <div className="space-y-2">
            <Label htmlFor="openai-key">OpenAI API Key</Label>
            <Input
              id="openai-key"
              type="password"
              placeholder="sk-..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={isValidating}
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value="anthropic" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Enter your Anthropic API key to use Claude models for manifest
            generation.
          </p>
          <div className="space-y-2">
            <Label htmlFor="anthropic-key">Anthropic API Key</Label>
            <Input
              id="anthropic-key"
              type="password"
              placeholder="sk_ant_..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={isValidating}
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value="other" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Enter your API key for other compatible LLM providers.
          </p>
          <div className="space-y-2">
            <Label htmlFor="other-key">API Key</Label>
            <Input
              id="other-key"
              type="password"
              placeholder="Enter API key..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={isValidating}
            />
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {keyError && <div className="text-sm text-destructive">{keyError}</div>}

      <div className="flex justify-between space-x-2 pt-2">
        {onGoBack && (
          <Button
            type="button"
            variant="outline"
            onClick={onGoBack}
            disabled={isValidating}
          >
            Back
          </Button>
        )}

        <Button
          type="submit"
          disabled={isValidating || !keyInput.trim()}
          className={onGoBack ? "" : "ml-auto"}
        >
          {isValidating ? "Validating..." : "Continue"}
        </Button>
      </div>

      <div className="text-xs text-muted-foreground mt-2">
        Your API key will be stored securely in your browser and only used for
        communication with the selected provider.
      </div>
    </form>
  );
}
