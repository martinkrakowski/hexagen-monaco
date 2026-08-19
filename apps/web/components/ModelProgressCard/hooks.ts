"use client";

import { useReducedMotion } from "framer-motion";
import { springSnappy, springGentle } from "./constants";
import type {
  LLMEngineStatus,
  ModelMetadata,
  DomainModelId,
} from "@hexagen/local-llm";
import { getModelDescriptor } from "@hexagen/local-llm";

export function useDownloadProgress(progress: number): { percent: number } {
  return { percent: Math.round(progress * 100) };
}

export function useProgressCardState(status: LLMEngineStatus): {
  isInProgress: boolean;
  isError: boolean;
  phaseLabel: string;
  statusTitle: string;
  statusSubtitle: string;
} {
  const isInProgress = status === "downloading" || status === "loading_vram";
  const isError = status === "error";
  const phaseLabel =
    status === "downloading"
      ? "Downloading Weights"
      : status === "loading_vram"
        ? "Compiling & Loading VRAM"
        : "";

  return {
    isInProgress,
    isError,
    phaseLabel,
    statusTitle: isError ? "Engine Error" : "Loading Model",
    statusSubtitle: isError
      ? "Intervention required"
      : "Initializing WebLLM Engine",
  };
}

export function useMotionPresets(): {
  enterSpring: Record<string, unknown>;
  enterGentle: Record<string, unknown>;
  footerTransition: Record<string, unknown>;
} {
  const shouldReduceMotion = useReducedMotion();
  return {
    enterSpring: shouldReduceMotion ? { duration: 0 } : springSnappy,
    enterGentle: shouldReduceMotion
      ? { duration: 0 }
      : { ...springGentle, delay: 0.22 },
    footerTransition: shouldReduceMotion ? { duration: 0 } : { duration: 0.22 },
  };
}

export function useModelDisplayData(
  model: ModelMetadata | null | undefined,
  modelId: DomainModelId | undefined,
): {
  displayModelId: DomainModelId | undefined;
  displayName: string;
} {
  const displayModelId = model?.modelId ?? modelId;
  const descriptor = displayModelId ? getModelDescriptor(displayModelId) : null;
  const displayName = descriptor?.displayName ?? "Local Model";

  return { displayModelId, displayName };
}
