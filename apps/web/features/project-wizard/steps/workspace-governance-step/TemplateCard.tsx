"use client";

import type { WorkspaceTemplate } from "@hexagen/shared";

interface TemplateCardProps {
  template: WorkspaceTemplate;
  isSelected: boolean;
  onSelect: () => void;
}

interface BadgeProps {
  label: string;
  tone: "muted" | "destructive";
}

function Badge({ label, tone }: BadgeProps) {
  const classes =
    tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`text-[10px] ${classes} px-2 py-0.5 rounded`}>
      {label}
    </span>
  );
}

const CROSS_CONTEXT_BADGE_LABELS: Record<string, string> = {
  "in-process": "In-Process",
  "event-bus": "Event-Driven",
  network: "Networked",
};

/**
 * Single card in the workspace-template grid. Shows title,
 * description, and rule-based tag badges (strictness + cross-context
 * communication pattern). Selection state is controlled — parent
 * owns the selected template id.
 */
export function TemplateCard({
  template,
  isSelected,
  onSelect,
}: TemplateCardProps) {
  const crossContextLabel =
    CROSS_CONTEXT_BADGE_LABELS[template.rules.crossContextCalls];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex flex-col p-4 cursor-pointer rounded-xl border-2 transition-all text-left ${
        isSelected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/50 hover:bg-muted/30"
      }`}
    >
      {isSelected && (
        <div className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-primary" />
      )}
      <div className="font-semibold text-sm mb-1 pr-5">{template.title}</div>
      <p className="text-xs text-muted-foreground flex-1 line-clamp-3">
        {template.description}
      </p>
      <div className="flex flex-wrap gap-1 mt-3">
        <Badge
          label={template.rules.strictness === "strict" ? "Strict" : "Flexible"}
          tone={
            template.rules.strictness === "strict" ? "destructive" : "muted"
          }
        />
        {crossContextLabel && <Badge label={crossContextLabel} tone="muted" />}
      </div>
    </button>
  );
}
