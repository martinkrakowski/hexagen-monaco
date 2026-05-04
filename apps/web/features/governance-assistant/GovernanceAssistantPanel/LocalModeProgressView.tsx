"use client";

import { ModelProgressCard } from "../ModelProgressCard/ModelProgressCard";
import type { ModeWrapperProps } from "./types";
import type {
  LLMEngineStatus,
  DomainModelId,
  ModelMetadata,
} from "@hexagen/local-llm";

function LifecycleCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1">{children}</div>
    </div>
  );
}

type LocalModeProgressViewProps = Pick<
  ModeWrapperProps,
  | "showProgress"
  | "showError"
  | "llmEngineState"
  | "onOpenSettings"
  | "onInitModel"
  | "loadedModel"
>;

export function LocalModeProgressView({
  showProgress,
  showError,
  llmEngineState,
  onOpenSettings,
  onInitModel,
  loadedModel,
}: LocalModeProgressViewProps) {
  if (!showProgress && !showError) {
    return null;
  }

  return (
    <div className="h-full">
      <LifecycleCard>
        <ModelProgressCard
          status={llmEngineState.status as LLMEngineStatus}
          progress={llmEngineState.progress}
          errorMessage={llmEngineState.errorMessage}
          onCancel={onOpenSettings}
          onRetry={onInitModel}
          model={loadedModel as ModelMetadata | null}
          modelId={llmEngineState.loadedModelId as DomainModelId | undefined}
        />
      </LifecycleCard>
    </div>
  );
}
