"use client";

import {
  LazyMotion,
  m,
  AnimatePresence,
  useReducedMotion,
  domAnimation,
} from "framer-motion";
import type {
  DomainModelId,
  LLMEngineStatus,
  ModelMetadata,
} from "@hexagen/local-llm";
import { getModelDescriptor } from "@hexagen/local-llm";

interface ModelProgressCardProps {
  status: LLMEngineStatus;
  progress: number;
  errorMessage: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  model?: ModelMetadata | null;
  modelId?: DomainModelId;
}

const springSnappy = {
  type: "spring" as const,
  damping: 28,
  stiffness: 380,
  mass: 0.7,
};
const springGentle = {
  type: "spring" as const,
  damping: 22,
  stiffness: 260,
  mass: 0.8,
};

// ── Inline SVG Icons ──────────────────────────────────────────────────────────

const CloseIcon = () => (
  <svg
    className="w-4 h-4"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

const LightningIcon = () => (
  <svg
    className="w-6 h-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 10V3L4 14h7v7l9-11h-7z"
    />
  </svg>
);

const AlertTriangleIcon = () => (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

const AlertCircleIcon = () => (
  <svg
    className="w-4 h-4"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const RefreshIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

// ── AttrRow ──────────────────────────────────────────────────────────────────

function AttrRow({
  label,
  value,
  delay,
}: {
  label: string;
  value: string | number;
  delay: number;
}) {
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

// ── Main Component ───────────────────────────────────────────────────────────

export function ModelProgressCard({
  status,
  progress,
  errorMessage,
  onCancel,
  onRetry,
  model,
  modelId,
}: ModelProgressCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const percent = Math.round(progress * 100);
  const isInProgress = status === "downloading" || status === "loading_vram";
  const isError = status === "error";

  const displayModelId = model?.modelId ?? modelId;
  const descriptor = displayModelId ? getModelDescriptor(displayModelId) : null;
  const displayName = descriptor?.displayName ?? "Local Model";

  const enterSpring = shouldReduceMotion ? { duration: 0 } : springSnappy;
  const enterGentle = shouldReduceMotion
    ? { duration: 0 }
    : { ...springGentle, delay: 0.22 };
  const enterInitial = shouldReduceMotion
    ? { opacity: 1, scale: 1, y: 0 }
    : { opacity: 0, scale: 0.94, y: 22 };

  const borderClass = isInProgress
    ? "bg-cinematic-border animate-spin-border shadow-[0_0_30px_hsl(var(--primary)_/_0.12),inset_0_0_15px_hsl(var(--primary)_/_0.05)]"
    : "bg-gradient-to-br from-destructive/15 via-transparent to-destructive/10";

  const phaseLabel =
    status === "downloading"
      ? "Downloading Weights"
      : status === "loading_vram"
        ? "Compiling & Loading VRAM"
        : "";

  const statusTitle = isError ? "Engine Error" : "Loading Model";
  const statusSubtitle = isError
    ? "Intervention required"
    : "Initializing WebLLM Engine";

  const footerTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.22 };

  return (
    <LazyMotion features={domAnimation}>
      <div className="flex items-center justify-center w-full h-full p-4">
        <m.div
          className={`p-1 rounded-[0.2rem] transition-all duration-700 ease-out ${borderClass}`}
          initial={enterInitial}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={enterSpring}
        >
          <div className="bg-card rounded-sm w-full overflow-hidden shadow-sm">
            {/* Header */}
            <m.div
              className="px-5 pt-5 pb-4"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 0.4, delay: 0.08 }
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
                      {statusTitle}
                    </h2>
                    <p className="text-xs mt-0.5 text-muted-foreground">
                      {statusSubtitle}
                    </p>
                  </div>
                </div>

                {onCancel && (
                  <button
                    type="button"
                    aria-label="Close"
                    className="w-[30px] h-[30px] rounded-sm flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    onClick={onCancel}
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>

              {/* Model Name Card */}
              <m.div
                className="bg-muted/50 dark:bg-muted border border-border rounded-sm px-4 py-3"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { duration: 0.4, delay: 0.14 }
                }
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold truncate text-foreground">
                    {displayName}
                  </span>
                  {model?.quantizeLevel && (
                    <span className="bg-primary/10 text-primary text-[10px] font-bold tracking-wide uppercase px-2 py-[2px] rounded-sm leading-none">
                      {model.quantizeLevel}
                    </span>
                  )}
                </div>
                <span className="font-mono block truncate text-[10.5px] text-muted-foreground">
                  {displayModelId || "Awaiting manifest..."}
                </span>
              </m.div>
            </m.div>

            {/* Attributes */}
            {model && (
              <m.div
                className="px-5 pb-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { duration: 0.3, delay: 0.2 }
                }
              >
                <div className="bg-muted/50 dark:bg-muted border border-border rounded-sm px-4 py-0.5">
                  {model.parameterSize && (
                    <AttrRow
                      label="Parameters"
                      value={model.parameterSize}
                      delay={0.24}
                    />
                  )}
                  {model.contextLength && (
                    <AttrRow
                      label="Context Window"
                      value={`${model.contextLength.toLocaleString()} tokens`}
                      delay={0.28}
                    />
                  )}
                  {model.quantizeLevel && (
                    <AttrRow
                      label="Quantization"
                      value={model.quantizeLevel}
                      delay={0.32}
                    />
                  )}
                </div>
              </m.div>
            )}

            {/* Progress Section */}
            <AnimatePresence mode="wait">
              {isInProgress && (
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
                        <span className="w-[7px] h-[7px] rounded-full bg-primary animate-dot-pulse" />
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
                      className="w-full h-[6px] bg-muted rounded-sm overflow-hidden relative"
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
              )}

              {isError && (
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
              )}
            </AnimatePresence>

            {/* Divider */}
            <div className="mx-5 h-px bg-border" />

            {/* Footer Actions */}
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
                      className="font-sans text-[13px] font-semibold px-[18px] py-2 rounded-sm border border-destructive/20 text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-none"
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
                        className="font-sans text-[13px] font-semibold px-[18px] py-2 rounded-sm border border-border text-muted-foreground hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
          </div>
        </m.div>
      </div>
    </LazyMotion>
  );
}
