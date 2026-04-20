import { RefreshCw, ShieldCheck } from "lucide-react";

interface PanelHeaderProps {
  onRefresh: () => void;
  isLoading: boolean;
}

export function PanelHeader({ onRefresh, isLoading }: PanelHeaderProps) {
  return (
    <div className="px-5 pt-5 pb-4 flex-shrink-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShieldCheck size={14} className="text-primary" strokeWidth={2} />
          </div>
          <h1 className="text-[15px] font-semibold text-foreground tracking-tight">
            Governance
          </h1>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground/80 hover:bg-muted/60 transition-colors disabled:opacity-50"
          title="Refresh checks"
        >
          <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground font-normal pl-[38px]">
        Governance Assistant
      </p>
    </div>
  );
}
