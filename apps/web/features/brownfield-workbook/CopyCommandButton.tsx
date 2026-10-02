"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Copies a command to the clipboard, and does nothing else: no fetch, no
 * fallback to a legacy copy path. The page never runs a command.
 */
export function CopyCommandButton({
  stepLabel,
  command,
  ordinal,
}: {
  readonly stepLabel: string;
  readonly command: string;
  /** Set when a step has several commands, so each button has its own name. */
  readonly ordinal?: number;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  };
  return (
    <>
      <button
        type="button"
        aria-label={`Copy ${stepLabel.toLowerCase()} command${ordinal === undefined ? "" : ` ${ordinal}`}`}
        onClick={() => void copy()}
        className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
      >
        Copy
      </button>
      <span role="status" className="ml-2 text-xs text-muted-foreground">
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed"
            : ""}
      </span>
    </>
  );
}
