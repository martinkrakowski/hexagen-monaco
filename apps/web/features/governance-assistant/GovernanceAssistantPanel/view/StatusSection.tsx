"use client";

import { StatusSummaryCard } from "../../governance";
import type { StatusSectionProps } from "../types";

export function StatusSection({ violations, suggestions }: StatusSectionProps) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
            <span className="text-primary font-bold text-xs">G</span>
          </div>
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
            Governance Checks
          </span>
        </div>
      </div>
      <StatusSummaryCard violations={violations} suggestions={suggestions} />
    </div>
  );
}
