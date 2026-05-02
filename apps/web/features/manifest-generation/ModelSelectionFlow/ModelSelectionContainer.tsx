"use client";

import { useCallback } from "react";
import { Card, CardContent } from "@hexagen/ui";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";

import { ModelCategorySelector } from "./ModelCategorySelector";
import { CloudProviderForm } from "./CloudProviderForm";
import { DownloadProgressIndicator } from "./DownloadProgressIndicator";
import { UnsupportedHardwareMessage } from "./UnsupportedHardwareMessage";
import { InterruptedView } from "./InterruptedView";

import type {
  WelcomeFlowState,
  WelcomeFlowActions,
  DomainModelId,
} from "./useWelcomeFlowState";

interface ModelSelectionContainerProps {
  flowState: WelcomeFlowState;
  flowActions: WelcomeFlowActions;
  llmContext: LocalLLMContext;
}

export function ModelSelectionContainer({
  flowState,
  flowActions,
  llmContext,
}: ModelSelectionContainerProps) {
  const { engineState } = llmContext;

  const handleLocalSelected = useCallback(
    (modelId: DomainModelId, remember: boolean) => {
      flowActions.selectLocalModel(modelId, remember);
    },
    [flowActions],
  );

  const handleCloudSelected = useCallback(
    (provider: string, apiKey: string, remember: boolean) => {
      flowActions.selectCloudProvider(provider, apiKey, remember);
    },
    [flowActions],
  );

  const handleCancel = useCallback(() => {
    if (flowState.state === "model_downloading") {
      flowActions.cancelModelDownload();
    } else {
      flowActions.skipAiSetup();
    }
  }, [flowActions, flowState.state]);

  const handleRetry = useCallback(() => {
    flowActions.transitionTo("model_selection");
  }, [flowActions]);

  // Render different views based on the current state
  const renderContent = () => {
    // Hardware support check
    if (
      engineState.status === "unsupported_browser" ||
      engineState.status === "no_webgpu"
    ) {
      return <UnsupportedHardwareMessage onCancel={handleCancel} />;
    }

    // State-based rendering
    switch (flowState.state) {
      case "model_selection":
        return (
          <ModelCategorySelector
            onLocalSelected={handleLocalSelected}
            onCloudSelected={handleCloudSelected}
            onCancel={handleCancel}
          />
        );

      case "model_downloading":
        return (
          <DownloadProgressIndicator
            onCancel={handleCancel}
            progress={engineState.progress || 0}
            phase={engineState.status}
          />
        );

      case "interrupted":
        return (
          <InterruptedView onRetry={handleRetry} onCancel={handleCancel} />
        );

      case "key_validation":
        return (
          <CloudProviderForm
            provider={flowState.cloudProvider || "openai"}
            apiKey={flowState.cloudApiKey || ""}
            onSubmit={(provider, key) =>
              handleCloudSelected(provider, key, !!flowState.rememberedChoice)
            }
            onGoBack={() => flowActions.transitionTo("model_selection")}
            isValidating={true}
          />
        );

      default:
        return (
          <ModelCategorySelector
            onLocalSelected={handleLocalSelected}
            onCloudSelected={handleCloudSelected}
            onCancel={handleCancel}
          />
        );
    }
  };

  return (
    <Card className="w-full max-w-xl mx-auto my-6">
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold mb-4">
          Set Up AI Engine for Manifest Generation
        </h2>
        <div className="space-y-4">{renderContent()}</div>
      </CardContent>
    </Card>
  );
}
