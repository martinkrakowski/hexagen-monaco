"use client";

import { useState, useEffect } from "react";

type Breakpoint = "sm" | "md" | "lg";

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
};

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("lg");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const getBreakpoint = (): Breakpoint => {
      const width = window.innerWidth;
      if (width < BREAKPOINTS.md) return "sm";
      if (width < BREAKPOINTS.lg) return "md";
      return "lg";
    };

    setBreakpoint(getBreakpoint());

    const handleResize = () => {
      setBreakpoint(getBreakpoint());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return breakpoint;
}
