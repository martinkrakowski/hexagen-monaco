"use client";

import React, { useRef, useState, useId } from "react";
import { Dialog, DialogContent, useFocusTrap } from "@hexagen/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TandemInterceptionModalProps {
  isOpen: boolean;
  localModelName: string;
  cloudProviderName: string;
  isByok: boolean;
  isFirstTime: boolean;
  /** e.g. "Continue using Cloud Only" */
  currentSetupDescription: string;
  onSelectPath: (path: "local-only" | "tandem" | "keep-current") => void;
  onCancel: () => void;
  onFirstTimeDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TandemInterceptionModal({
  isOpen,
  localModelName,
  cloudProviderName,
  isByok,
  isFirstTime,
  currentSetupDescription,
  onSelectPath,
  onCancel,
  onFirstTimeDismiss,
}: TandemInterceptionModalProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [learnMoreExpanded, setLearnMoreExpanded] = useState(false);

  useFocusTrap({ isActive: isOpen, containerRef });

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={onCancel}>
      <DialogContent
        ref={containerRef}
        className="max-w-lg w-full"
        aria-label="Tandem Mode routing decision"
        aria-labelledby={titleId}
        role="dialog"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-1">
          <h2
            id={titleId}
            className="text-base font-semibold text-foreground leading-snug pr-6"
          >
            You now have both a local model and a cloud model available.
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
          >
            {/* X icon via SVG — no new dependency */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Subtitle ───────────────────────────────────────────────────── */}
        <p className="text-xs text-muted-foreground mb-4">
          Local: {localModelName} · Cloud: {cloudProviderName}
          {isByok ? " (BYOK)" : ""}
        </p>

        {/* ── First-time orientation panel ───────────────────────────────── */}
        {isFirstTime && (
          <div className="mb-4 p-3 rounded-lg border border-info/30 bg-info/5 space-y-2 animate-fade-in-up">
            <p className="text-xs font-semibold text-foreground">
              Welcome to Tandem Mode
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside leading-relaxed">
              <li>
                Stage 1: your local model drafts a response (content is
                ephemeral and not stored).
              </li>
              <li>Stage 2: the cloud model refines and finalises the draft.</li>
              {isByok && (
                <li>
                  BYOK cost: each turn consumes tokens from both your local
                  model and your BYOK API key.
                </li>
              )}
              <li>
                You can reconfigure or disable Tandem Mode at any time in
                Settings.
              </li>
            </ul>
            <button
              type="button"
              onClick={onFirstTimeDismiss}
              className="mt-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm active:scale-[0.98]"
            >
              Got it
            </button>
          </div>
        )}

        {/* ── Path tiles ─────────────────────────────────────────────────── */}
        <div
          className="space-y-2 mb-4"
          role="group"
          aria-label="Choose a routing path"
        >
          {/* Path A — Local Only */}
          <PathTile
            label="Use Local Model Only"
            description="Disables your cloud connection for this session. All inference runs in your browser."
            variant="standard"
            onSelect={() => onSelectPath("local-only")}
          />

          {/* Path B — Tandem (recommended) */}
          <PathTile
            label="Use in Tandem"
            description={
              isByok
                ? "Your local model drafts a response first. The cloud model then refines and finalizes it."
                : "Your local model drafts a response first. The cloud model then refines and finalizes it."
            }
            variant="highlighted"
            onSelect={() => onSelectPath("tandem")}
            byokNotice={
              isByok
                ? "Each tandem conversation turn uses tokens from both your local model and your BYOK API key. Your API provider may charge for all tokens including the enriched context payload."
                : undefined
            }
          />

          {/* Path C — Keep Current */}
          <PathTile
            label="Keep Current Setup"
            description={currentSetupDescription}
            variant="subdued"
            onSelect={() => onSelectPath("keep-current")}
          />
        </div>

        {/* ── Learn More expander ────────────────────────────────────────── */}
        <div className="border-t border-border/40 pt-3">
          <button
            type="button"
            onClick={() => setLearnMoreExpanded((v) => !v)}
            aria-expanded={learnMoreExpanded}
            aria-controls="tandem-learn-more-panel"
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm active:scale-[0.98]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={`transition-transform duration-200 ${learnMoreExpanded ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            Learn More
          </button>

          {learnMoreExpanded && (
            <div
              id="tandem-learn-more-panel"
              className="mt-3 space-y-2 text-xs text-muted-foreground leading-relaxed animate-fade-in-up"
            >
              <p>
                <span className="font-medium text-foreground">
                  What is Tandem Mode?
                </span>{" "}
                Tandem Mode runs a two-stage inference pipeline. Your local
                model generates a draft response entirely in your browser (Stage
                1), then a cloud model refines and finalises it (Stage 2).
              </p>
              <p>
                <span className="font-medium text-foreground">
                  Pipeline stages:
                </span>{" "}
                Stage 1 content is ephemeral — it is never stored or sent
                anywhere except as context to the cloud refinement step. Stage 2
                produces the final response you see.
              </p>
              <p>
                <span className="font-medium text-foreground">Latency:</span>{" "}
                Tandem Mode adds latency compared to single-model inference
                because both stages must complete sequentially. A Stage 1
                timeout (configurable in Settings) prevents indefinite waits.
              </p>
              {isByok && (
                <p>
                  <span className="font-medium text-foreground">
                    BYOK token cost:
                  </span>{" "}
                  Each turn sends the enriched context payload (local draft +
                  conversation history) to your BYOK provider. Your API provider
                  charges for all tokens in that payload.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// PathTile sub-component
// ---------------------------------------------------------------------------

interface PathTileProps {
  label: string;
  description: string;
  variant: "standard" | "highlighted" | "subdued";
  onSelect: () => void;
  byokNotice?: string;
}

function PathTile({
  label,
  description,
  variant,
  onSelect,
  byokNotice,
}: PathTileProps) {
  const tileClasses: Record<PathTileProps["variant"], string> = {
    standard: "border border-border bg-card hover:bg-accent/80 text-foreground",
    highlighted:
      "border-2 border-primary bg-primary/5 hover:bg-primary/10 text-foreground",
    subdued:
      "border border-border/60 bg-muted/30 hover:bg-muted/50 text-muted-foreground",
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] ${tileClasses[variant]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug">{label}</span>
        {variant === "highlighted" && (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary">
            Recommended
          </span>
        )}
      </div>
      <p className="text-xs mt-1 leading-relaxed opacity-80">{description}</p>
      {byokNotice && (
        <p className="mt-2 text-xs leading-relaxed p-2 rounded-md border border-warning/30 bg-warning/5 text-warning-foreground">
          {byokNotice}
        </p>
      )}
    </button>
  );
}
