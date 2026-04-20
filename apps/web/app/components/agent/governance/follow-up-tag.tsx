import { Sparkles } from "lucide-react";

interface FollowUpTagProps {
  label: string;
  onClick: () => void;
  disabled: boolean;
}

export function FollowUpTag({ label, onClick, disabled }: FollowUpTagProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "bg-muted/20 border border-card-border text-foreground/80 hover:bg-primary/5 hover:border-primary/25 hover:text-primary",
      ].join(" ")}
    >
      <Sparkles size={10} />
      {label}
    </button>
  );
}
