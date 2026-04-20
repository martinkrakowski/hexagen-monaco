"use client";

import { useSyncExternalStore } from "react";

type Breakpoint = "sm" | "md" | "lg";

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
};

function getBreakpoint(): Breakpoint {
  if (typeof window === "undefined") return "lg";
  const width = window.innerWidth;
  if (width < BREAKPOINTS.md) return "sm";
  if (width < BREAKPOINTS.lg) return "md";
  return "lg";
}

function subscribe(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(
    subscribe,
    getBreakpoint,
    () => "lg" as Breakpoint,
  );
}
