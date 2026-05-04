"use client";

import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import { CloseIcon, RefreshIcon } from "./icons";
import { useMotionPresets } from "./hooks";
import type { ActionButtonsProps } from "./types";

export function ActionButtons({
  isInProgress,
  isError,
  onCancel,
  onRetry,
}: ActionButtonsProps) {
  const shouldReduceMotion = useReducedMotion();
  const { footerTransition } = useMotionPresets();

  return (
    <div className="px-5 py-4 flex items-center justify-end gap-2.5 bg-muted/30">
      <AnimatePresence mode="wait">
        {isInProgress && onCancel && (
          <m.div
            key="dl-actions"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={footerTransition}
          >
            <m.button
              type="button"
              aria-label="Cancel download"
              className="font-sans text-sm font-semibold px-5 py-2 rounded-sm border border-destructive/20 text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-none"
              whileHover={{ scale: shouldReduceMotion ? 1 : 1.02 }}
              whileTap={{ scale: shouldReduceMotion ? 1 : 0.97 }}
              onClick={onCancel}
            >
              <CloseIcon />
              Cancel Loading
            </m.button>
          </m.div>
        )}

        {isError && (
          <m.div
            key="err-actions"
            className="flex items-center gap-2.5"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={footerTransition}
          >
            {onCancel && (
              <m.button
                type="button"
                aria-label="Close"
                className="font-sans text-sm font-semibold px-5 py-2 rounded-sm border border-border text-muted-foreground hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                whileHover={{ scale: shouldReduceMotion ? 1 : 1.02 }}
                whileTap={{ scale: shouldReduceMotion ? 1 : 0.97 }}
                onClick={onCancel}
              >
                Close
              </m.button>
            )}
            {onRetry && (
              <m.button
                type="button"
                aria-label="Retry download"
                className="font-sans text-[13px] font-semibold px-[18px] py-2 rounded-sm bg-primary text-primary-foreground hover:brightness-110 transition-all flex items-center gap-1.5 shadow-[0_2px_16px_hsl(var(--primary)_/_0.2)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                whileHover={{ scale: shouldReduceMotion ? 1 : 1.02 }}
                whileTap={{ scale: shouldReduceMotion ? 1 : 0.97 }}
                onClick={onRetry}
              >
                <RefreshIcon />
                Retry Download
              </m.button>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
