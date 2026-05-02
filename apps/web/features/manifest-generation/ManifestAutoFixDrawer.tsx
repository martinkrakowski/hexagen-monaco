import { useState, useEffect } from "react";
import { X, Check, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@hexagen/ui";
import { diffLines, type Change } from "diff";
import type { ValidationItem } from "./manifest-view-data";

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patchedYaml, setPatchedYaml] = useState<string | null>(null);
  const [diffChanges, setDiffChanges] = useState<Change[]>([]);

  useEffect(() => {
    if (!isOpen || !violation) {
      setPatchedYaml(null);
      setError(null);
      setDiffChanges([]);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    async function fetchFix() {
      try {
        const isCrossContext = !violation?.contextName;

        let contextYaml = "";
        if (!isCrossContext && violation?.contextName) {
          const lines = currentYaml.split("\n");
          const startIndex = lines.findIndex(
            (l) =>
              l.startsWith("  - name: ") && l.includes(violation!.contextName!),
          );
          if (startIndex !== -1) {
            let endIndex = startIndex + 1;
            while (
              endIndex < lines.length &&
              (lines[endIndex].startsWith("    ") ||
                lines[endIndex].trim() === "")
            ) {
              endIndex++;
            }
            contextYaml = lines.slice(startIndex, endIndex).join("\n");
          }
        }

        const response = await fetch("/api/manifest/fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            manifestYaml: currentYaml,
            contextYaml,
            violationMessage: violation?.description,
            isCrossContext,
          }),
        });

        const data = await response.json();

        if (!isMounted) return;

        if (data.success && data.patchedYaml) {
          let fullPatchedYaml = data.patchedYaml;
          if (!isCrossContext && contextYaml) {
            fullPatchedYaml = currentYaml.replace(
              contextYaml,
              data.patchedYaml,
            );
          }
          setPatchedYaml(fullPatchedYaml);
          setDiffChanges(diffLines(currentYaml, fullPatchedYaml));
        } else {
          setError(data.error || "Failed to generate fix");
        }
      } catch (e) {
        if (!isMounted) return;
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchFix();

    return () => {
      isMounted = false;
    };
  }, [isOpen, violation, currentYaml]);

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
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
            <p className="text-sm font-mono animate-pulse">
              Generating patch...
            </p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-mono">
            {error}
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
        <Button variant="ghost" onClick={onClose} disabled={isLoading}>
          Discard
        </Button>
        <Button
          onClick={() => patchedYaml && onApply(patchedYaml)}
          disabled={isLoading || !patchedYaml}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
        >
          <Check className="w-4 h-4 mr-2" /> Apply Fix
        </Button>
      </div>
    </div>
  );
}
