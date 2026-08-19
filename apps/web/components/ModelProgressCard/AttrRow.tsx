"use client";

import { m, useReducedMotion } from "framer-motion";
import type { AttrRowProps } from "./types";

export function AttrRow({ label, value, delay }: AttrRowProps) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <m.div
      className="flex justify-between items-center py-2 border-b border-border/40 last:border-b-0"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { duration: 0.35, delay, ease: [0.25, 0.46, 0.45, 0.94] }
      }
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xs font-medium font-mono text-foreground">
        {value}
      </span>
    </m.div>
  );
}
