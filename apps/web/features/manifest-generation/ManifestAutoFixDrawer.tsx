import { useMemo } from "react";
import { X, Check, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@hexagen/ui";
import { diffLines, type Change } from "diff";
import { applyDeterministicFix, canAutoFix } from "@hexagen/manifest-generation";
import type { ValidationItem } from "@hexagen/manifest-generation";

export interface ManifestAutoFixDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (patchedYaml: string) => void;
  violation: ValidationItem | null;
  currentYaml: string;
}

export function ManifestAutoFixDrawer({
  isOpen,
  onClose,
  onApply,
  violation,
  currentYaml,
}: ManifestAutoFixDrawerProps) {
  const isFixable = violation ? canAutoFix(violation) : false;

  const patchedYaml = useMemo(() => {
    if (!isOpen || !violation || !isFixable) return null;
    return applyDeterministicFix(currentYaml, violation);
  }, [isOpen, violation, currentYaml, isFixable]);

  const diffChanges: Change[] = useMemo(() => {
    if (!patchedYaml) return [];
    return diffLines(currentYaml, patchedYaml);
  }, [currentYaml, patchedYaml]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-y-0 right-0 w-full max-w-2xl bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface shrink-0">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span className="text-accent">✨</span> Auto-Fix
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">
            {violation?.title}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-md hover:bg-muted/50 transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 bg-background">
        {!isFixable ? (
          <div className="p-4 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4" />
              Manual Edit Required
            </div>
            <p>
              This violation cannot be auto-fixed. Please edit the YAML directly
              in the sidebar.
            </p>
          </div>
        ) : !patchedYaml ? (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-mono">
            Fix could not be applied. The violation may already be resolved.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-border text-xs font-mono text-muted-foreground uppercase tracking-wider">
              <span>Original</span>
              <ArrowRight className="w-3 h-3" />
              <span className="text-success">Patched</span>
            </div>
            <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {diffChanges.map((part, index) => (
                <span
                  key={index}
                  className={
                    part.added
                      ? "bg-success/20 text-success px-1 py-0.5 rounded-sm"
                      : part.removed
                        ? "bg-destructive/20 text-destructive px-1 py-0.5 rounded-sm line-through opacity-70"
                        : "text-foreground opacity-80"
                  }
                >
                  {part.value}
                </span>
              ))}
            </pre>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface shrink-0">
        <Button variant="ghost" onClick={onClose}>
          Discard
        </Button>
        <Button
          onClick={() => patchedYaml && onApply(patchedYaml)}
          disabled={!patchedYaml}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
        >
          <Check className="w-4 h-4 mr-2" /> Apply Fix
        </Button>
      </div>
    </div>
  );
}
