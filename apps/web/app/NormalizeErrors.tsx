"use client";

import { useEffect } from "react";

export function NormalizeErrors() {
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      if (!(error instanceof Error)) return;

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
