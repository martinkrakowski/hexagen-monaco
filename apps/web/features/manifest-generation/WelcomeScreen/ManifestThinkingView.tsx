"use client";

import { useRef, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@hexagen/ui";
import type { GenerationPhase } from "../useClientManifestGeneration";

const STEP_ORDER: GenerationPhase[] = ["topology", "adapters", "rendering"];

const STEP_LABELS: Partial<Record<GenerationPhase, string>> = {
  topology: "Building Topology",
  adapters: "Extracting Adapters",
  rendering: "Rendering Manifest",
};

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

interface ManifestThinkingViewProps {
  phase: GenerationPhase;
  stepDetail: string;
  onCancel: () => void;
}

function StepDot({ state }: { state: "completed" | "active" | "pending" }) {
  if (state === "completed") {
    return (
      <div className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
    );
  }
  if (state === "active") {
    return (
      <div className="w-2.5 h-2.5 rounded-full bg-accent shrink-0 step-dot-active" />
    );
  }
  return (
    <div className="w-2 h-2 rounded-full border border-muted-foreground/20 shrink-0" />
  );
}

function DetailLine({ text }: { text: string }) {
  const prevText = usePrevious(text);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (prevText !== undefined && prevText !== text) {
      setIsTransitioning(true);
      const t = setTimeout(() => setIsTransitioning(false), 400);
      setTimer(t);
      return () => clearTimeout(t);
    }
  }, [text, prevText]);

  useEffect(() => {
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [timer]);

  return (
    <div className="relative overflow-hidden h-5">
      {isTransitioning && prevText !== undefined && (
        <div className="detail-rolodex-exit absolute inset-x-0 top-0">
          <span className="text-sm text-muted-foreground">{prevText}</span>
        </div>
      )}
      <div className={isTransitioning ? "detail-rolodex-enter" : ""}>
        <span className="text-sm text-muted-foreground">{text}</span>
      </div>
    </div>
  );
}

export function ManifestThinkingView({
  phase,
  stepDetail,
  onCancel,
}: ManifestThinkingViewProps) {
  const label = STEP_LABELS[phase];
  if (!label) return null;

  const currentStepIndex = STEP_ORDER.indexOf(phase);

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <div className="flex items-center gap-3">
        {STEP_ORDER.map((step, index) => {
          let dotState: "completed" | "active" | "pending";
          if (index < currentStepIndex) dotState = "completed";
          else if (index === currentStepIndex) dotState = "active";
          else dotState = "pending";

          return (
            <div key={step} className="flex items-center gap-2">
              <StepDot state={dotState} />
              {index < STEP_ORDER.length - 1 && (
                <div className="w-8 h-px bg-border" />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-center justify-center gap-2 py-4">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-accent animate-spin" />
          <span className="text-base font-semibold text-foreground">
            {label}
          </span>
        </div>
        <DetailLine text={stepDetail} />
      </div>

      <div className="flex justify-center pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="w-3.5 h-3.5 mr-1.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
