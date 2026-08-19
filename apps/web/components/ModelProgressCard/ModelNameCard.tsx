"use client";

import { m, useReducedMotion } from "framer-motion";
import type { ModelNameCardProps } from "./types";

export function ModelNameCard({
  displayName,
  displayModelId,
  quantizeLevel,
}: ModelNameCardProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <m.div
      className="bg-muted/50 dark:bg-muted border border-border rounded-sm px-4 py-3"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        shouldReduceMotion ? { duration: 0 } : { duration: 0.4, delay: 0.14 }
      }
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-sm font-semibold truncate text-foreground">
          {displayName}
        </span>
        {quantizeLevel && (
          <span className="bg-primary/10 text-primary text-xs font-bold tracking-wide uppercase px-2 py-0.5 rounded-sm leading-none">
            {quantizeLevel}
          </span>
        )}
      </div>
      <span className="font-mono block truncate text-xs text-muted-foreground">
        {displayModelId || "Awaiting manifest..."}
      </span>
    </m.div>
  );
}
