"use client";

import { useEffect, useRef, useState } from "react";
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
  // The engine value comes from a localStorage-persisted store, so the
  // server always renders the "auto" default while the client's first
  // render may already hold a persisted override — a hydration mismatch on
  // aria-checked/classes. Display the default until after mount so the
  // first client render matches the SSR HTML, then flip.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const displayEngine: ExecutionEngine = mounted ? engine : "auto";

  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Radiogroup keyboard semantics: one tab stop (the active option), arrow
  // keys move selection and focus together.
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % OPTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + OPTIONS.length) % OPTIONS.length;
    } else {
      return;
    }
    event.preventDefault();
    onEngineChange(OPTIONS[next].value);
    buttonRefs.current[next]?.focus();
  };

  const selected = OPTIONS.find((o) => o.value === displayEngine) ?? OPTIONS[0];

  return (
    <div className="space-y-1">
      <Label id="execution-engine-label">Execution engine</Label>
      <div
        role="radiogroup"
        aria-labelledby="execution-engine-label"
        className="inline-flex w-full rounded-md border border-input bg-background p-0.5"
      >
        {OPTIONS.map((option, index) => {
          const isActive = option.value === displayEngine;
          return (
            <button
              key={option.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              disabled={isDisabled}
              onClick={() => onEngineChange(option.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
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
