import { Button, Badge } from "@hexagen/ui";
import { ManifestPreview } from "../ManifestPreview";
import type { ClarificationTrigger } from "@hexagen/agentic-interaction";
import type { DomainModelId } from "../../../lib/llm-interfaces";
import { GENERATE_WITH_AI_ERROR_MESSAGES } from "./GenerateWithAiError";
import type { StateViewProps } from "./types";

const TRIGGER_TYPE_LABELS: Record<ClarificationTrigger["type"], string> = {
  "no-inbound-ports": "No Inbound Ports",
  "single-context-no-outbound": "No Outbound Ports",
  "generic-context-name": "Generic Name",
};

export function StateView({
  flowState,
  actions,
  onUseManifest,
  onConfirmAndContinue,
  onRegenerate,
  onRetryFromError,
  externalActiveTab,
  onTabChange,
}: StateViewProps) {
  // Clarification needed
  if (flowState.state === "clarification_needed") {
    const triggers = flowState.clarificationTriggers ?? [];
    return (
      <div className="space-y-4">
        <div className="text-center space-y-2 mb-4">
          <h2 className="text-2xl font-bold text-foreground">
            Topology Review
          </h2>
          <p className="text-base text-muted-foreground">
            The AI identified the following concerns about your project
            topology. Review them and confirm to continue generating adapters.
          </p>
        </div>

        {triggers.map((trigger, index: number) => {
          const triggerType = trigger.type as ClarificationTrigger["type"];
          return (
            <div
              key={`${trigger.type}-${trigger.contextName ?? index}`}
              className="flex items-start gap-4 p-4 bg-secondary rounded-md"
            >
              <Badge variant="outline">
                {TRIGGER_TYPE_LABELS[triggerType] ?? trigger.type}
              </Badge>
              <div className="flex-1 space-y-1">
                {trigger.contextName && (
                  <p className="text-sm font-medium text-foreground">
                    {trigger.contextName}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {trigger.message}
                </p>
              </div>
            </div>
          );
        })}

        <div className="flex gap-2 justify-end pt-4">
          <Button variant="ghost" onClick={() => actions.transitionTo("idle")}>
            Cancel
          </Button>
          <Button onClick={onConfirmAndContinue}>Continue Anyway</Button>
        </div>
      </div>
    );
  }

  // Preview state
  if (flowState.state === "preview" && flowState.manifestContent) {
    return (
      <ManifestPreview
        manifestYaml={flowState.manifestContent}
        onApprove={(yaml) => onUseManifest?.(yaml)}
        onRegenerate={onRegenerate}
        onStartOver={actions.rejectManifest}
        hideActions
        hideHeader
        embedded
        activeTab={externalActiveTab}
        onTabChange={onTabChange}
      />
    );
  }

  // Model downloading
  if (flowState.state === "model_downloading") {
    return (
      <div className="space-y-6 text-center">
        <h2 className="text-2xl font-bold text-foreground">
          Downloading Model
        </h2>
        <p className="text-base text-muted-foreground">
          Please wait while the local AI model is downloaded...
        </p>
        <div className="w-full max-w-md mx-auto">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${flowState.generationProgress || 0}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {Math.round(flowState.generationProgress || 0)}% complete
          </p>
        </div>
        <Button variant="ghost" onClick={actions.cancelModelDownload}>
          Cancel Download
        </Button>
      </div>
    );
  }

  // Error state
  if (flowState.state === "error") {
    const errorMessage = flowState.errorCode
      ? GENERATE_WITH_AI_ERROR_MESSAGES[
          flowState.errorCode as keyof typeof GENERATE_WITH_AI_ERROR_MESSAGES
        ]
      : flowState.error || "An unknown error occurred";

    return (
      <div className="space-y-6 text-center">
        <h2 className="text-2xl font-bold text-destructive">Error</h2>
        <p className="text-base text-muted-foreground">{errorMessage}</p>
        <div className="flex gap-2 justify-center flex-wrap">
          <Button onClick={onRetryFromError}>Retry</Button>
          {flowState.errorCode === "model_corrupted" &&
            flowState.selectedModelId && (
              <Button
                variant="outline"
                onClick={() =>
                  actions.repairModelDownload(
                    flowState.selectedModelId as DomainModelId,
                  )
                }
              >
                Repair Download
              </Button>
            )}
          <Button variant="ghost" onClick={() => actions.transitionTo("idle")}>
            Back to Description
          </Button>
        </div>
      </div>
    );
  }

  // Unsupported browser
  if (flowState.state === "unsupported") {
    return (
      <div className="space-y-6 text-center">
        <h2 className="text-2xl font-bold text-destructive">
          Unsupported Browser
        </h2>
        <p className="text-base text-muted-foreground">
          Your browser does not support WebGPU, which is required for local AI
          models. Please use Chrome or Edge, or switch to cloud model.
        </p>
        <Button onClick={() => actions.transitionTo("idle")}>
          Back to Description
        </Button>
      </div>
    );
  }

  // Key validation
  if (flowState.state === "key_validation") {
    return (
      <div className="space-y-6 text-center">
        <h2 className="text-2xl font-bold text-foreground">
          Validating API Key
        </h2>
        <p className="text-base text-muted-foreground">
          Please wait while we validate your API key...
        </p>
        <div className="flex justify-center">
          <span className="animate-spin text-2xl">⏳</span>
        </div>
      </div>
    );
  }

  return null;
}
