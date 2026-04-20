import type { DomainModelId } from "@hexagen/local-llm";
import { ModelFooterIndicator } from "../ModelFooterIndicator";

interface StorageFooterProps {
  totalCached: number;
  totalCachedSize: number;
  currentModelId: DomainModelId | null;
  isLoading: boolean;
}

export function StorageFooter({
  totalCached,
  totalCachedSize,
  currentModelId,
  isLoading,
}: StorageFooterProps) {
  if (totalCached <= 0) return null;

  return (
    <footer className="flex-shrink-0 p-2 border-t border-border bg-background">
      <div className="flex items-center justify-between gap-4 w-full">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium">
            {totalCached} model{totalCached !== 1 ? "s" : ""} cached
          </span>
          <span className="mx-2">·</span>
          <span>{totalCachedSize.toFixed(2)} GB</span>
        </div>
        <ModelFooterIndicator
          modelId={currentModelId}
          onOpenSettings={() => {}}
          isLoading={isLoading}
        />
      </div>
    </footer>
  );
}
