import { Checkbox, Label, Button } from "@hexagen/ui";
import { MODEL_METADATA_MAP } from "@hexagen/local-llm";
import type { ModelCapabilityCheckProps } from "./types";

function getParameterSize(modelId: string | null): string {
  if (!modelId) return "sub-3B";
  return (
    (MODEL_METADATA_MAP as Record<string, any>)[modelId]?.parameterSize ??
    "sub-3B"
  );
}

export function ModelCapabilityCheck({
  modelNativelyCapable,
  manifestCapable,
  loadedModelId,
  overrideModelCheck,
  onOverrideChange,
  onSwitchModel,
}: ModelCapabilityCheckProps) {
  if (manifestCapable && loadedModelId) {
    return null;
  }

  return (
    <>
      {!manifestCapable && loadedModelId && !overrideModelCheck && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium text-amber-600 dark:text-amber-400">
            Manifest generation requires the 3B model
          </p>
          <p className="mt-1 text-muted-foreground">
            The {getParameterSize(loadedModelId)} model cannot reliably produce
            structured JSON. Switch to a 3B+ model in model settings to enable
            generation.
          </p>
          <div className="mt-2 flex items-start gap-2">
            <Checkbox
              id="override-model-check"
              checked={overrideModelCheck}
              onCheckedChange={(checked) => onOverrideChange(checked === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="override-model-check"
              className="text-xs text-muted-foreground leading-tight cursor-pointer"
            >
              Proceed anyway with the current model (results may be unreliable)
            </Label>
          </div>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={onSwitchModel}>
              Switch Model
            </Button>
          </div>
        </div>
      )}

      {overrideModelCheck && modelNativelyCapable === false && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <Checkbox
            id="override-model-check-active"
            checked={true}
            onCheckedChange={(checked) => {
              if (checked !== true) onOverrideChange(false);
            }}
            className="h-3 w-3"
          />
          <Label
            htmlFor="override-model-check-active"
            className="text-xs cursor-pointer"
          >
            Model override active — using {getParameterSize(loadedModelId)}{" "}
            model
          </Label>
        </div>
      )}
    </>
  );
}
