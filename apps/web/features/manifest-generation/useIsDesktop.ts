"use client";

import { useSyncExternalStore } from "react";

const MD_BREAKPOINT = 768; // Tailwind `md` — where the YAML sidebar appears.

function getIsDesktop(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= MD_BREAKPOINT;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

/**
 * True at the Tailwind `md` breakpoint (768px) and up — where the manifest YAML
 * sidebar is shown. SSR-safe (defaults to desktop). Local to this feature:
 * apps/web forbids cross-feature hook imports (hexagen-ui/no-feature-slice-imports),
 * so this mirrors workspace-shell's useBreakpoint rather than importing it.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getIsDesktop, () => true);
}
