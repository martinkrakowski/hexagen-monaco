"use client";

import {
  LazyMotion,
  m,
  AnimatePresence,
  domAnimation,
  useReducedMotion,
} from "framer-motion";
import { ProgressCardHeader } from "./ProgressCardHeader";
import { ModelNameCard } from "./ModelNameCard";
import { ModelAttributesSection } from "./ModelAttributesSection";
import { ProgressSection } from "./ProgressSection";
import { ErrorSection } from "./ErrorSection";
import { ActionButtons } from "./ActionButtons";
import {
  useDownloadProgress,
  useProgressCardState,
  useMotionPresets,
  useModelDisplayData,
} from "./hooks";
import type { ModelProgressCardProps } from "./types";

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
  const { percent } = useDownloadProgress(progress);
  const { isInProgress, isError, phaseLabel, statusTitle, statusSubtitle } =
    useProgressCardState(status);
  const { enterSpring } = useMotionPresets();
  const { displayModelId, displayName } = useModelDisplayData(model, modelId);

  const borderClass = isInProgress
    ? "shadow-md"
    : "bg-gradient-to-br from-destructive/15 via-transparent to-destructive/10";

  const enterInitial = shouldReduceMotion
    ? { opacity: 1, scale: 1, y: 0 }
    : { opacity: 0, scale: 0.94, y: 22 };

  return (
    <LazyMotion features={domAnimation}>
      <div className="flex items-center justify-center w-full h-full p-4">
        <m.div
          className={`p-1 rounded-sm transition-all duration-700 ease-out ${borderClass}`}
          initial={enterInitial}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={enterSpring}
        >
          <div className="bg-card rounded-sm w-full overflow-hidden shadow-sm">
            <ProgressCardHeader
              title={statusTitle}
              subtitle={statusSubtitle}
              isError={isError}
              onCancel={onCancel}
            />

            <div className="px-4 pb-4">
              <ModelNameCard
                displayName={displayName}
                displayModelId={displayModelId}
                quantizeLevel={model?.quantizeLevel}
              />
            </div>

            {model && <ModelAttributesSection model={model} />}

            <AnimatePresence mode="wait">
              {isInProgress && (
                <ProgressSection percent={percent} phaseLabel={phaseLabel} />
              )}
              {isError && <ErrorSection errorMessage={errorMessage} />}
            </AnimatePresence>

            <div className="mx-4 h-1 bg-border" />

            <ActionButtons
              isInProgress={isInProgress}
              isError={isError}
              onCancel={onCancel}
              onRetry={onRetry}
            />
          </div>
        </m.div>
      </div>
    </LazyMotion>
  );
}
