"use client";

import { useState } from "react";
import { Wrench, Check } from "lucide-react";
import { applyRepairOpsToYaml } from "@hexagen/agentic-interaction";
import { usePendingManifest } from "./store/usePendingManifest";
import type { ContextFix } from "./request-context-fixes";
import { FixConfirmDialog } from "./FixConfirmDialog";

interface ContextFixSuggestionsProps {
  fixes: ContextFix[];
  status: "idle" | "loading" | "ready" | "error";
  appliedIds: ReadonlySet<string>;
  onApplied: (id: string) => void;
}

/**
 * The "Apply" buttons beneath the context review. Each button is one AI-suggested
 * fix; clicking it opens a confirmation dialog, and confirming applies the fix's
 * deterministic ops to the manifest via `usePendingManifest.updateYaml` — which
 * re-derives the YAML sidebar, context map, Mermaid, and Validation views.
 */
export function ContextFixSuggestions({
  fixes,
  status,
  appliedIds,
  onApplied,
}: ContextFixSuggestionsProps) {
  const [pendingFix, setPendingFix] = useState<ContextFix | null>(null);
  const updateYaml = usePendingManifest((s) => s.updateYaml);

  if (status === "loading") {
    return (
      <div className="px-4 py-2 border-t border-border shrink-0 text-xs text-muted-foreground animate-pulse">
        Looking for fixes…
      </div>
    );
  }
  if (fixes.length === 0) return null;

  const handleConfirm = () => {
    if (!pendingFix) return;
    // Apply against the live manifest (the store is the source of truth, synced
    // from ManifestPreview's localManifestYaml via onYamlChange).
    const current = usePendingManifest.getState().yaml ?? "";
    const { yaml } = applyRepairOpsToYaml(current, pendingFix.ops);
    updateYaml(yaml);
    onApplied(pendingFix.id);
    setPendingFix(null);
  };

  return (
    <div className="px-4 py-2 border-t border-border shrink-0 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Suggested fixes
      </p>
      <div className="flex flex-wrap gap-2">
        {fixes.map((fix) => {
          const applied = appliedIds.has(fix.id);
          return (
            <button
              key={fix.id}
              type="button"
              disabled={applied}
              onClick={() => setPendingFix(fix)}
              title={fix.rationale || fix.label}
              className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-card flex items-center gap-1.5 hover:border-accent hover:bg-accent/10 transition-colors disabled:opacity-60 disabled:cursor-default disabled:hover:border-border disabled:hover:bg-card"
            >
              {applied ? (
                <Check className="w-3 h-3 text-success shrink-0" />
              ) : (
                <Wrench className="w-3 h-3 text-accent shrink-0" />
              )}
              {fix.label}
            </button>
          );
        })}
      </div>

      <FixConfirmDialog
        open={pendingFix !== null}
        fix={pendingFix}
        isApplying={false}
        onConfirm={handleConfirm}
        onCancel={() => setPendingFix(null)}
      />
    </div>
  );
}
