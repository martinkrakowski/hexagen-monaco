"use client";

import { useState } from "react";
import { Boxes, ChevronDown, TriangleAlert, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from "@hexagen/ui";
import { StepHeader } from "../StepHeader";
import { WizardFooter } from "../../WizardFooter";
import { AddOnCard } from "./AddOnCard";
import { CompanionBanner } from "./CompanionBanner";
import {
  TEMPLATE_CATALOG,
  CATEGORIES,
  CATEGORY_LABELS,
  findCompanionSuggestions,
  planSelection,
  resolveMissingRequires,
  type CatalogEntry,
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
  const { selectedIds, toggle, isSelected, resolveSelection } =
    useSelectedAddOns();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        CATEGORIES.map((c) => [c, c === "foundation"]),
      ) as Record<string, boolean>,
  );
  const [conflict, setConflict] = useState<{
    entry: CatalogEntry;
    conflicts: CatalogEntry[];
  } | null>(null);
  // The required dependencies the user is being asked to add alongside `entry`.
  // `removeIds` carries any conflicting selections to swap out in the same atomic
  // update (set when the dependency prompt follows a conflict switch).
  const [pendingDeps, setPendingDeps] = useState<{
    entry: CatalogEntry;
    deps: CatalogEntry[];
    removeIds: string[];
  } | null>(null);

  function missingDeps(id: string): string[] {
    const entry = TEMPLATE_CATALOG.find((e) => e.id === id);
    if (!entry) return [];
    return entry.requires.filter((dep) => !selectedIds.includes(dep));
  }

  // Selecting routes through planSelection: deselect → conflict prompt →
  // dependency prompt → plain select (in that priority). Nothing is committed
  // until the user confirms, so cancelling any dialog leaves the selection clean.
  function handleSelect(entry: CatalogEntry): void {
    const plan = planSelection(entry.id, selectedIds);
    switch (plan.kind) {
      case "deselect":
        toggle(entry.id);
        return;
      case "conflict":
        setConflict({ entry, conflicts: plan.conflicts });
        return;
      case "deps":
        setPendingDeps({ entry, deps: plan.deps, removeIds: [] });
        return;
      case "select":
        resolveSelection([entry.id], []);
        return;
    }
  }

  // Conflict resolution first, THEN dependency prompting on the post-switch
  // state — so we never prompt to add a dep for a template the user is swapping
  // out. The swap + deps are applied together (one atomic update) on confirm.
  function confirmSwitch(): void {
    if (!conflict) return;
    const removeIds = conflict.conflicts.map((c) => c.id);
    const postSwitch = selectedIds.filter((id) => !removeIds.includes(id));
    const deps = resolveMissingRequires(conflict.entry.id, postSwitch);
    setConflict(null);
    if (deps.length > 0) {
      setPendingDeps({ entry: conflict.entry, deps, removeIds });
    } else {
      resolveSelection([conflict.entry.id], removeIds);
    }
  }

  function confirmAddDeps(): void {
    if (!pendingDeps) return;
    resolveSelection(
      [pendingDeps.entry.id, ...pendingDeps.deps.map((d) => d.id)],
      pendingDeps.removeIds,
    );
    setPendingDeps(null);
  }

  // Adding a companion goes through the same conflict-check path as a normal
  // selection so the user gets the conflict dialog if the suggestion clashes
  // with an existing pick.
  function handleAddCompanion(id: string): void {
    const entry = TEMPLATE_CATALOG.find((e) => e.id === id);
    if (!entry) return;
    handleSelect(entry);
  }

  const totalSelected = selectedIds.length;
  const companionSuggestions = findCompanionSuggestions(selectedIds).map(
    (e) => ({ id: e.id, name: e.name, description: e.description }),
  );

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title ?? "Add-On Templates"}
        description={
          description ??
          "Select production add-ons to apply after project generation. Required dependencies and conflicts are resolved here; the CLI re-checks at install."
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
                          onToggle={() => handleSelect(entry)}
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

        {companionSuggestions.length > 0 && (
          <CompanionBanner
            suggestions={companionSuggestions}
            onAdd={handleAddCompanion}
          />
        )}

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

      <Dialog open={conflict !== null} onClose={() => setConflict(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlert size={18} className="text-destructive" />
                Conflicting templates
              </DialogTitle>
              <button
                type="button"
                onClick={() => setConflict(null)}
                className="text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0 mt-0.5"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            {conflict && (
              <DialogDescription>
                <span className="font-medium text-foreground">
                  {conflict.entry.name}
                </span>{" "}
                can&apos;t be combined with{" "}
                <span className="font-medium text-foreground">
                  {conflict.conflicts.map((c) => c.name).join(", ")}
                </span>
                . These templates are mutually exclusive — only one can be
                active.
              </DialogDescription>
            )}
          </DialogHeader>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConflict(null)}>
              Keep current selection
            </Button>
            <Button variant="default" onClick={confirmSwitch}>
              Switch to {conflict?.entry.name}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDeps !== null} onClose={() => setPendingDeps(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <DialogTitle className="flex items-center gap-2">
                <Boxes size={18} className="text-primary" />
                Required dependencies
              </DialogTitle>
              <button
                type="button"
                onClick={() => setPendingDeps(null)}
                className="text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0 mt-0.5"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            {pendingDeps && (
              <DialogDescription>
                <span className="font-medium text-foreground">
                  {pendingDeps.entry.name}
                </span>{" "}
                requires{" "}
                <span className="font-medium text-foreground">
                  {pendingDeps.deps.map((d) => d.name).join(" · ")}
                </span>
                . Add {pendingDeps.deps.length === 1 ? "it" : "them"} too?
              </DialogDescription>
            )}
          </DialogHeader>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDeps(null)}>
              Cancel
            </Button>
            <Button variant="default" onClick={confirmAddDeps}>
              {pendingDeps
                ? `Add ${pendingDeps.entry.name} + ${pendingDeps.deps.length} ${
                    pendingDeps.deps.length === 1
                      ? "dependency"
                      : "dependencies"
                  }`
                : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
