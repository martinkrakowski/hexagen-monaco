"use client";

import { Loader2 } from "lucide-react";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm";
import { UnavailableCard } from "../../UnavailableCard";
import { WakingUpCard } from "../../WakingUpCard";
import { ModelProgressCard } from "@/ModelProgressCard";
import { LocalModeSettingsView } from "./LocalModeSettingsView";
import type { LocalLifecycle } from "../lifecycle";
import type { ServerCapabilityNames } from "../types";

export interface LocalModeViewProps {
  /** The single source of truth for which card this view shows (REA-002). */
  lifecycle: LocalLifecycle;
  /** Engine busy — disables destructive actions in the settings card. */
  isLoading: boolean;
  capabilities: ServerCapabilityNames;
  serverAssistantAvailable: boolean;
  loadedModel: ModelMetadata | null;
  loadedModelId: DomainModelId | null;
  messagesLength: number;
  onCancelDownload: () => void;
  onOpenSettings: () => void;
  onInitModel: () => void;
  onBackFromSettings: () => void;
  onSwitchToCloud: () => void;
  onSwitchModel: (modelId: DomainModelId) => Promise<void>;
  onDeleteModel: (modelId: DomainModelId) => Promise<void>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
  onResetConfig?: () => void;
}

function LifecycleCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full">
      <div className="h-full flex flex-col">
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * Local-engine half of the panel: one lifecycle in, one card out.
 *
 * The `never` in the final arm is the guard. It used to be three components
 * chained by `if (a || b || c) return …`, each re-reading a different subset of
 * six booleans, and a state nobody had handled rendered `null` — a blank panel
 * with no failing test anywhere. Now an unhandled variant does not compile.
 */
export function LocalModeView({
  lifecycle,
  isLoading,
  capabilities,
  serverAssistantAvailable,
  loadedModel,
  loadedModelId,
  messagesLength,
  onCancelDownload,
  onOpenSettings,
  onInitModel,
  onBackFromSettings,
  onSwitchToCloud,
  onSwitchModel,
  onDeleteModel,
  hasModelInCache,
  onResetConfig,
}: LocalModeViewProps) {
  switch (lifecycle.kind) {
    case "booting":
      return (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="animate-spin" size={20} />
        </div>
      );

    case "unsupported":
      return (
        <LifecycleCard>
          <UnavailableCard status={lifecycle.reason} />
        </LifecycleCard>
      );

    case "waking-up":
      return (
        <LifecycleCard>
          <WakingUpCard onCancel={onCancelDownload} />
        </LifecycleCard>
      );

    case "loading":
    case "failed":
      return (
        <LifecycleCard>
          <ModelProgressCard
            status={lifecycle.kind === "failed" ? "error" : lifecycle.status}
            progress={lifecycle.kind === "failed" ? 0 : lifecycle.progress}
            errorMessage={
              lifecycle.kind === "failed" ? lifecycle.message : null
            }
            onCancel={onOpenSettings}
            onRetry={onInitModel}
            model={loadedModel}
            modelId={loadedModelId ?? undefined}
          />
        </LifecycleCard>
      );

    // Both reach the settings card; only one of them warns that a model still
    // has to be picked. The panel only renders this view for these two kinds
    // when the user is in the model-settings view, so there is no null-render
    // guard here any more.
    case "requires-model":
    case "usable":
      return (
        <LocalModeSettingsView
          requiresModel={lifecycle.kind === "requires-model"}
          isLoading={isLoading}
          capabilities={capabilities}
          serverAssistantAvailable={serverAssistantAvailable}
          loadedModel={loadedModel}
          loadedModelId={loadedModelId}
          messagesLength={messagesLength}
          onSwitchModel={onSwitchModel}
          onDeleteModel={onDeleteModel}
          hasModelInCache={hasModelInCache}
          onBackFromSettings={onBackFromSettings}
          onSwitchToCloud={onSwitchToCloud}
          onResetConfig={onResetConfig}
        />
      );

    default: {
      const unhandled: never = lifecycle;
      throw new Error(
        `Unhandled local lifecycle: ${JSON.stringify(unhandled)}`,
      );
    }
  }
}
