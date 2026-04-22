import { ArrowLeft } from "lucide-react";

interface ModelSettingsHeaderProps {
  onBack?: () => void;
}

export function ModelSettingsHeader({ onBack }: ModelSettingsHeaderProps) {
  return (
    <div className="mb-4 px-2 py-3 flex-shrink-0 border-b border-border">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground/80 hover:bg-muted/60 transition-colors"
              title="Back to governance"
              aria-label="Back to governance"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <h1 className="text-[15px] font-semibold text-foreground tracking-tight">
            AI Model Settings
          </h1>
        </div>
      </div>
      <p className="text-xs text-muted-foreground font-normal pl-[38px]">
        Select and manage AI models
      </p>
    </div>
  );
}
