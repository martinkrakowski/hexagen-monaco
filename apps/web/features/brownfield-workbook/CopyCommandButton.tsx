"use client";

import { useState } from "react";

/**
 * Copies a command to the clipboard, and does nothing else: no fetch, no
 * fallback to a legacy copy path. The page never runs a command.
 */
export function CopyCommandButton({
  stepLabel,
  command,
}: {
  readonly stepLabel: string;
  readonly command: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <>
      <button
        type="button"
        aria-label={`Copy ${stepLabel.toLowerCase()} command`}
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
