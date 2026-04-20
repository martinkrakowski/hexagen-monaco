import { Info } from "lucide-react";
import type { DomainModelId } from "@hexagen/local-llm";
import { SystemInfoButton } from "../SystemInfoButton";
import { ModelFooterIndicator } from "../ModelFooterIndicator";

interface PanelFooterProps {
  modelId?: DomainModelId | null;
  onOpenSettings?: () => void;
  isLoading?: boolean;
  showHint?: boolean;
}

export function PanelFooter({
  modelId,
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
              <p className="text-[11px] text-muted-foreground/60">
                Click a question to get an AI-powered answer
              </p>
            </>
          )}
        </div>
        {modelId !== undefined && onOpenSettings && (
          <ModelFooterIndicator
            modelId={modelId}
            onOpenSettings={onOpenSettings}
            isLoading={isLoading ?? false}
          />
        )}
      </div>
    </div>
  );
}
