"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@hexagen/ui";
import type { RepairOp } from "@hexagen/agentic-interaction";
import type { ContextFix } from "./request-context-fixes";

interface FixConfirmDialogProps {
  open: boolean;
  fix: ContextFix | null;
  isApplying: boolean;
  /** Set when a confirmed apply changed nothing — shown inline, dialog stays open. */
  notice?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Human-readable line for one edit-op — shown instead of a raw YAML diff (the
 * apply re-serializes the whole manifest, so a text diff would be reformat-noisy;
 * the op list states exactly what changes). */
function describeOp(op: RepairOp): string {
  switch (op.op) {
    case "remove-in-port":
      return `Remove inbound port "${op.name}"`;
    case "remove-out-port":
      return `Remove outbound port "${op.name}"`;
    case "remove-adapter":
      return `Remove adapter "${op.name}"`;
    case "add-in-port":
      return `Add inbound port "${op.name}"`;
    case "add-out-port":
      return `Add outbound port "${op.name}"`;
    case "add-adapter":
      return `Add adapter "${op.name}"`;
    case "rename-port":
      return `Rename port "${op.from}" → "${op.to}"`;
    case "remove-context":
      return `Remove context "${op.context}"`;
    case "rename-context":
      return `Rename context "${op.from}" → "${op.to}"`;
  }
}

/**
 * Confirms applying one AI-suggested fix to the manifest. Lists the exact edit-ops
 * so the user sees precisely what will change before it's written to manifest.yaml.
 */
export function FixConfirmDialog({
  open,
  fix,
  isApplying,
  notice,
  onConfirm,
  onCancel,
}: FixConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply this fix?</DialogTitle>
          <DialogDescription>
            {fix?.label}
            {fix?.rationale ? (
              <span className="block mt-1 text-muted-foreground">
                {fix.rationale}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Changes to manifest.yaml
          </p>
          <ul className="space-y-1.5">
            {(fix?.ops ?? []).map((op, i) => (
              <li
                key={i}
                className="text-sm flex items-start gap-2 font-mono text-foreground"
              >
                <span className="text-accent shrink-0">•</span>
                <span>{describeOp(op)}</span>
              </li>
            ))}
          </ul>
        </div>

        {notice ? (
          <p
            role="alert"
            className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2"
          >
            {notice}
          </p>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors border border-input"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isApplying}
            className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApplying ? "Applying…" : "Apply"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
