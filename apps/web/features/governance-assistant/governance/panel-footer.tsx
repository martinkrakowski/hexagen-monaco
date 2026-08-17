import { Info } from "lucide-react";
import type { DomainModelId } from "@hexagen/local-llm";
import { SystemInfoButton } from "../SystemInfoButton";
import { ModelFooterIndicator } from "../ModelFooterIndicator";

interface PanelFooterProps {
  modelId?: DomainModelId | null;
  modelLabel?: string;
  onOpenSettings?: () => void;
  isLoading?: boolean;
  showHint?: boolean;
}

export function PanelFooter({
  modelId,
  modelLabel,
  onOpenSettings,
  isLoading,
  showHint = true,
}: PanelFooterProps) {
  return (
    <div className="flex-shrink-0 p-2 border-t border-border bg-background">
      <div className="flex items-center justify-between gap-4 w-full">
        <div className="flex items-center gap-2">
          <SystemInfoButton />
          {showHint && (
            <>
              <Info size={12} className="text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground/60">
                Click a question to get an AI-powered answer
              </p>
            </>
          )}
        </div>
        {/*
          Gated on the callback alone. The model name is a label, not the
          reason the control exists: with a server-side assistant and no local
          model, `modelLabel` is undefined until the capability probe confirms
          a name — and stays undefined if it fails — and this chip is the Q&A
          view's only route into model settings.
        */}
        {onOpenSettings && (
          <ModelFooterIndicator
            modelId={modelId}
            modelLabel={modelLabel}
            fallbackLabel="Manage models"
            onOpenSettings={onOpenSettings}
            isLoading={isLoading ?? false}
          />
        )}
      </div>
    </div>
  );
}
