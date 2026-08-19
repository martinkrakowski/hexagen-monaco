"use client";

import { m, useReducedMotion } from "framer-motion";
import { AlertTriangleIcon, LightningIcon, CloseIcon } from "./icons";
import { useMotionPresets } from "./hooks";
import type { ProgressCardHeaderProps } from "./types";

export function ProgressCardHeader({
  title,
  subtitle,
  isError,
  onCancel,
}: ProgressCardHeaderProps) {
  const { enterGentle } = useMotionPresets();
  const shouldReduceMotion = useReducedMotion();

  return (
    <m.div
      className="px-5 pt-5 pb-4"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        shouldReduceMotion ? { duration: 0 } : { duration: 0.4, delay: 0.08 }
      }
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <m.div
            className={`w-11 h-11 rounded-sm flex items-center justify-center shrink-0 ${
              isError
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary"
            }`}
            initial={{
              scale: 0.95,
              opacity: 0,
              rotate: shouldReduceMotion ? 0 : -15,
            }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={enterGentle}
          >
            {isError ? <AlertTriangleIcon /> : <LightningIcon />}
          </m.div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground leading-tight">
              {title}
            </h2>
            <p className="text-xs mt-0.5 text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        {onCancel && (
          <button
            type="button"
            aria-label="Close"
            className="w-8 h-8 rounded-sm flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            onClick={onCancel}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </m.div>
  );
}
