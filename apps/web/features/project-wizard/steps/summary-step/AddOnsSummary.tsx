"use client";

import { useSelectedAddOns } from "../../contexts/SelectedAddOnsContext";
import { TEMPLATE_CATALOG } from "../add-ons-step/template-catalog";
import { SummarySection } from "./SummarySection";

export function AddOnsSummary() {
  const { selectedIds } = useSelectedAddOns();

  if (selectedIds.length === 0) return null;

  const entries = selectedIds
    .map((id) => TEMPLATE_CATALOG.find((e) => e.id === id))
    .filter(Boolean);

  return (
    <SummarySection title="Add-On Templates">
      <div className="space-y-3">
        <ul className="space-y-1">
          {entries.map((entry) => (
            <li key={entry!.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 text-primary">✓</span>
              <span>
                <span className="font-medium">{entry!.name}</span>
                <span className="text-muted-foreground text-xs ml-2">
                  {entry!.description}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="rounded-md bg-muted/40 border border-border p-3">
          <p className="text-xs text-muted-foreground mb-1">
            After downloading and installing dependencies, run:
          </p>
          <code className="text-xs font-mono text-primary block break-all">
            yarn templates:add {selectedIds.join(" ")}
          </code>
        </div>
      </div>
    </SummarySection>
  );
}
