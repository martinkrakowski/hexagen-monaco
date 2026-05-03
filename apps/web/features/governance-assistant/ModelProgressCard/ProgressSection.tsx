"use client";

import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import type { ProgressSectionProps } from "./types";

export function ProgressSection({ percent, phaseLabel }: ProgressSectionProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <m.div
        key="downloading"
        className="px-5 pb-4 overflow-hidden"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }
        }
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-dot-pulse" />
              <span
                className="text-xs font-medium text-primary"
                aria-live="polite"
              >
                {phaseLabel}
              </span>
            </div>
            <span
              className="font-mono text-sm font-semibold text-foreground"
              aria-hidden="true"
            >
              {percent}%
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${percent}% complete — ${phaseLabel}`}
            className="w-full h-1.5 bg-muted rounded-sm overflow-hidden relative"
          >
            <div
              className="h-full rounded-sm bg-gradient-to-r from-primary to-primary/80 transition-all duration-300 ease-out relative"
              style={{ width: `${percent}%` }}
            >
              {percent < 100 && percent > 0 && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer" />
              )}
            </div>
          </div>
        </div>
      </m.div>
    </AnimatePresence>
  );
}
