"use client";

import { useState } from "react";
import { Button, Label, Tabs, Checkbox } from "@hexagen/ui";
import type { DomainModelId } from "@hexagen/local-llm";
import { CloudProviderForm } from "./CloudProviderForm";
import { LocalModelOptions } from "./LocalModelOptions";

interface ModelCategorySelectorProps {
  onLocalSelected: (modelId: DomainModelId, remember: boolean) => void;
  onCloudSelected: (
    provider: string,
    apiKey: string,
    remember: boolean,
  ) => void;
  onCancel: () => void;
}

export function ModelCategorySelector({
  onLocalSelected,
  onCloudSelected,
  onCancel,
}: ModelCategorySelectorProps) {
  const [rememberChoice, setRememberChoice] = useState(false);
  const [activeTab, setActiveTab] = useState("local");

  const handleLocalModelSelect = (modelId: DomainModelId) => {
    onLocalSelected(modelId, rememberChoice);
  };

  const handleCloudSelected = (provider: string, apiKey: string) => {
    onCloudSelected(provider, apiKey, rememberChoice);
  };

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground mb-4">
        To generate your manifest, choose how you'd like to power AI features:
      </p>

      <Tabs.Root
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <Tabs.List className="grid grid-cols-2 mb-4">
          <Tabs.Trigger value="local">Local Model (Private)</Tabs.Trigger>
          <Tabs.Trigger value="cloud">Cloud Provider</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="local" className="space-y-4">
          <LocalModelOptions onSelect={handleLocalModelSelect} />

          <div className="text-sm text-muted-foreground">
            <p>
              Local models run directly in your browser without sending data to
              external services.
            </p>
            <p>Models will be downloaded once and cached for future use.</p>
          </div>
        </Tabs.Content>

        <Tabs.Content value="cloud" className="space-y-4">
          <CloudProviderForm
            onSubmit={handleCloudSelected}
            isValidating={false}
          />
        </Tabs.Content>
      </Tabs.Root>

      <div className="flex items-center space-x-2 mt-4">
        <Checkbox
          id="remember-choice"
          checked={rememberChoice}
          onCheckedChange={(checked: boolean | "indeterminate") => {
            if (typeof checked === "boolean") {
              setRememberChoice(checked);
            }
          }}
        />
        <Label htmlFor="remember-choice" className="text-sm font-normal">
          Remember my choice for future sessions
        </Label>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onCancel} size="sm">
          Skip AI setup for now
        </Button>
      </div>
    </div>
  );
}
