"use client";

import { useState, type FormEvent } from "react";
import {
  Send,
  RotateCcw,
  XCircle,
  CheckCircle,
  AlertTriangle,
  Wrench,
} from "lucide-react";
import { useArchitectureModification } from "../hooks/useArchitectureModification";
import { PipelineStepIndicator } from "./PipelineStepIndicator";
import { PatchReviewPanel } from "./PatchReviewPanel";
import { ManifestDiffView } from "./ManifestDiffView";

export function ArchitectureModificationPanel() {
  const {
    status,
    steps,
    result,
    error,
    modify,
    abort,
    reset,
    acceptPatch,
    rejectPatch,
  } = useArchitectureModification();

  const patches = result?.patches ?? [];

  const [intent, setIntent] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = intent.trim();
    if (!trimmed || status === "streaming") return;
    modify(trimmed);
  };

  const handleAbort = () => {
    abort();
  };

  const handleReset = () => {
    reset();
    setIntent("");
  };

  const isStreaming = status === "streaming";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-5 pt-5 pb-4 flex-shrink-0">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Wrench size={14} className="text-primary" strokeWidth={2} />
          </div>
          <h1 className="text-base font-semibold text-foreground tracking-tight">
            Architecture Modification
          </h1>
        </div>
        <p className="text-xs text-muted-foreground font-normal pl-10">
          AI-driven pipeline for manifest changes
        </p>
      </div>

      <div className="h-px mx-5 bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-5">
        {steps.length > 0 && (
          <div>
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60 mb-3 block">
              Pipeline Progress
            </span>
            <PipelineStepIndicator steps={steps} />
          </div>
        )}

        {isCompleted && result && (
          <div className="rounded-lg border border-success/30 bg-success/5 p-4">
            <div className="flex items-start gap-2.5">
              <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Pipeline completed
                </p>
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span>Patches: {result.patchesApplied}</span>
                  <span>
                    Lint:{" "}
                    <span
                      className={
                        result.lintPassed ? "text-success" : "text-destructive"
                      }
                    >
                      {result.lintPassed ? "Passed" : "Failed"}
                    </span>
                  </span>
                  <span className="font-mono">
                    {result.pipelineRunId.slice(0, 16)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {isFailed && error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Pipeline failed
                </p>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {error}
                </p>
              </div>
            </div>
          </div>
        )}

        {isCompleted && patches.length > 0 && (
          <PatchReviewPanel
            patches={patches}
            onAccept={acceptPatch}
            onReject={rejectPatch}
          />
        )}

        {isCompleted && <ManifestDiffView current={[]} proposed={[]} />}
      </div>

      <div className="flex-shrink-0 p-2 border-t border-border bg-background">
        <div className="flex items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-2">
            <Wrench size={12} className="text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground/60">
              Describe the architecture change you want
            </p>
          </div>
          {(isCompleted || isFailed) && (
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-3 pb-3 shrink-0"
      >
        <input
          type="text"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="e.g. Add a billing bounded context..."
          disabled={isStreaming}
          className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={handleAbort}
            className="h-9 px-3 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
          >
            <XCircle size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!intent.trim()}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        )}
      </form>
    </div>
  );
}
