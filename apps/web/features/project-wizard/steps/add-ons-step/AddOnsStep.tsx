"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { StepHeader } from "../StepHeader";
import { WizardFooter } from "../../WizardFooter";
import { AddOnCard } from "./AddOnCard";
import {
  TEMPLATE_CATALOG,
  CATEGORIES,
  CATEGORY_LABELS,
} from "./template-catalog";
import { useSelectedAddOns } from "../../contexts/SelectedAddOnsContext";

interface AddOnsStepProps {
  onNext: () => void;
  onBack: () => void;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

export function AddOnsStep({
  onNext,
  onBack,
  currentStep = 5,
  totalSteps = 6,
  title,
  description,
}: AddOnsStepProps) {
  const { selectedIds, toggle, isSelected } = useSelectedAddOns();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        CATEGORIES.map((c) => [c, c === "foundation"]),
      ) as Record<string, boolean>,
  );

  function missingDeps(id: string): string[] {
    const entry = TEMPLATE_CATALOG.find((e) => e.id === id);
    if (!entry) return [];
    return entry.requires.filter((dep) => !selectedIds.includes(dep));
  }

  const totalSelected = selectedIds.length;

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title ?? "Add-On Templates"}
        description={
          description ??
          "Select production add-ons to apply after project generation. Dependencies are auto-resolved by the CLI."
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-4">
        <div className="space-y-1">
          {CATEGORIES.map((category) => {
            const entries = TEMPLATE_CATALOG.filter(
              (e) => e.category === category,
            );
            const isOpen = expanded[category];
            const selectedInCategory = entries.filter((e) =>
              isSelected(e.id),
            ).length;

            return (
              <div
                key={category}
                className="rounded-lg border border-border overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [category]: !prev[category],
                    }))
                  }
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {CATEGORY_LABELS[category]}
                    </span>
                    {selectedInCategory > 0 && (
                      <span className="text-xs font-semibold bg-primary/15 text-primary rounded-full px-1.5 leading-none">
                        {selectedInCategory}
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    size={13}
                    className={[
                      "text-muted-foreground/60 transition-transform",
                      isOpen ? "rotate-180" : "",
                    ].join(" ")}
                  />
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 pt-1">
                    <div className="flex flex-col gap-2">
                      {entries.map((entry) => (
                        <AddOnCard
                          key={entry.id}
                          entry={entry}
                          isSelected={isSelected(entry.id)}
                          onToggle={() => toggle(entry.id)}
                          blockedBy={
                            isSelected(entry.id) ? missingDeps(entry.id) : []
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {totalSelected > 0 && (
          <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold text-foreground mb-1">
              After generation, run:
            </p>
            <code className="text-xs text-primary font-mono block break-all">
              yarn templates:add {selectedIds.join(" ")}
            </code>
          </div>
        )}
      </div>

      <WizardFooter
        onBack={onBack}
        onNext={onNext}
        canProceed={true}
        currentStep={currentStep}
        totalSteps={totalSteps}
        nextLabel="Review"
      />
    </div>
  );
}
