"use client";

import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import { AlertCircleIcon } from "./icons";
import type { ErrorSectionProps } from "./types";

export function ErrorSection({ errorMessage }: ErrorSectionProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <m.div
        key="error"
        className="px-5 pb-4 overflow-hidden"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }
        }
      >
        <div className="bg-destructive/10 border border-destructive/10 rounded-sm px-4 py-3.5 flex items-start gap-3">
          <div className="mt-0.5 text-destructive">
            <AlertCircleIcon />
          </div>
          <div>
            <span className="text-sm font-semibold block text-destructive leading-tight mb-1">
              Operation Failed
            </span>
            <span className="text-xs text-muted-foreground break-words">
              {errorMessage ||
                "An unknown error occurred while provisioning the engine."}
            </span>
          </div>
        </div>
      </m.div>
    </AnimatePresence>
  );
}
