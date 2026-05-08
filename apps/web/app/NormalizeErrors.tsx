"use client";

import { useEffect } from "react";

export function NormalizeErrors() {
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      if (!(error instanceof Error)) return;

      // Suppresses DOMException from @hexagen/local-llm browser-only code imported
      // server-side during SSR. Next.js's logErrorWithOriginalStack tries
      // `error.message = message`, which throws for getter-only properties.
      // The server-side root cause was fixed by converting static imports to
      // dynamic imports, but this browser-level handler remains as a safety net.
      // TODO: Remove once SSR import chain is fully verified stable (track in PR #56)
      const proto = Object.getPrototypeOf(error);
      const desc = Object.getOwnPropertyDescriptor(proto, "message");
      if (desc && typeof desc.get === "function" && desc.set === undefined) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", handler, { capture: true });
    return () => {
      window.removeEventListener("unhandledrejection", handler, {
        capture: true,
      });
    };
  }, []);

  return null;
}
