"use client";

import { Label } from "@hexagen/ui";
import type { ExecutionEngine } from "./store/useExecutionEngine";

interface ExecutionEngineSelectorProps {
  engine: ExecutionEngine;
  onEngineChange: (engine: ExecutionEngine) => void;
  isDisabled?: boolean;
}

const OPTIONS: Array<{
  value: ExecutionEngine;
  label: string;
  description: string;
}> = [
  { value: "auto", label: "Auto", description: "Cloud when available" },
  { value: "cloud", label: "Cloud", description: "Server-side models" },
  { value: "local", label: "Local", description: "WebLLM in your browser" },
];

/**
 * Segmented control for the execution-engine override (persisted via
 * useExecutionEngine). @hexagen/ui has no Select/RadioGroup primitive, so
 * this is a hand-rolled radiogroup over button elements.
 */
export function ExecutionEngineSelector({
  engine,
  onEngineChange,
  isDisabled = false,
}: ExecutionEngineSelectorProps) {
  const selected = OPTIONS.find((o) => o.value === engine) ?? OPTIONS[0];

  return (
    <div className="space-y-1">
      <Label id="execution-engine-label">Execution engine</Label>
      <div
        role="radiogroup"
        aria-labelledby="execution-engine-label"
        className="inline-flex w-full rounded-md border border-input bg-background p-0.5"
      >
        {OPTIONS.map((option) => {
          const isActive = option.value === engine;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={isDisabled}
              onClick={() => onEngineChange(option.value)}
              className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{selected.description}</p>
    </div>
  );
}
