import React from "react";

export type TandemBadgeState = "active" | "degraded" | "unavailable" | "off";

export interface TandemModeBadgeProps {
  state: TandemBadgeState;
}

export function TandemModeBadge({ state }: TandemModeBadgeProps) {
  if (state === "off") return null;

  let dotColor = "";
  let text = "";
  let badgeClasses = "";

  switch (state) {
    case "active":
      dotColor = "bg-success";
      text = "Tandem Mode Active";
      badgeClasses = "bg-success/10 text-success border-success/20";
      break;
    case "degraded":
      dotColor = "bg-warning";
      text = "Tandem Mode Degraded";
      badgeClasses = "bg-warning/10 text-warning border-warning/20";
      break;
    case "unavailable":
      dotColor = "bg-destructive";
      text = "Tandem Mode Unavailable";
      badgeClasses = "bg-destructive/10 text-destructive border-destructive/20";
      break;
    default:
      return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium transition-colors ${badgeClasses}`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} animate-soft-pulse`}
      />
      <span>{text}</span>
    </div>
  );
}
