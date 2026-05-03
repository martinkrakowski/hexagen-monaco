import { Button, Checkbox, Label } from "@hexagen/ui";
import { ModelSettingsView } from "@hexagen/model-settings";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";

interface ModelSelectionViewProps {
  flowState: any;
  llmContext: LocalLLMContext;
  rememberChoice: boolean;
  onRememberChoiceChange: (value: boolean) => void;
  onSelectModel: (modelId: string) => void;
  onBack: () => void;
  onModelReady: () => void;
}

export function ModelSelectionView({
  flowState,
  llmContext,
  rememberChoice,
  onRememberChoiceChange,
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

      <div className="flex justify-between items-center">
        <label
          htmlFor="remember-choice"
          className="flex items-center space-x-2 cursor-pointer"
        >
          <Checkbox
            id="remember-choice"
            checked={rememberChoice}
            onCheckedChange={(checked) =>
              onRememberChoiceChange(checked === true)
            }
          />
          <span className="text-sm text-muted-foreground">
            Remember my choice for future sessions
          </span>
        </label>
      </div>

      <div className="text-center">
        <Button variant="ghost" onClick={onBack}>
          Back to Description
        </Button>
      </div>
    </div>
  );
}
