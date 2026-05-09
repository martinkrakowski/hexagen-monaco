import { Button } from "@hexagen/ui";
import { ModelSettingsView } from "@hexagen/model-settings";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type { ModelSelectionFlowState } from "./types";

interface ModelSelectionViewProps {
  flowState: ModelSelectionFlowState;
  llmContext: LocalLLMContext;
  onSelectModel: (modelId: string) => void;
  onBack: () => void;
  onModelReady: () => void;
}

export function ModelSelectionView({
  flowState,
  llmContext,
  onSelectModel,
  onBack,
  onModelReady,
}: ModelSelectionViewProps) {
  if (flowState.state !== "model_selection") {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-foreground">
          Welcome to HexaGen Monaco
        </h2>
        <p className="text-base text-muted-foreground">
          Configure your AI model for manifest generation
        </p>
      </div>

      <ModelSettingsView
        currentModelId={flowState.selectedModelId ?? null}
        loadedModel={llmContext.loadedModel}
        messagesLength={0}
        onSwitchModel={async (modelId) => onSelectModel(modelId)}
        onDeleteModel={(modelId) => llmContext.deleteCachedModel(modelId)}
        hasModelInCache={(modelId) => llmContext.hasModelInCache(modelId)}
        onBack={onBack}
        isLoading={
          llmContext.engineState.status === "downloading" ||
          llmContext.engineState.status === "loading_vram"
        }
        onSwitchToCloud={undefined}
        requiresModelWarning={false}
      />

      {flowState.isModelReady && (
        <div className="text-center">
          <Button onClick={onModelReady}>Generate Manifest</Button>
        </div>
      )}
    </div>
  );
}
