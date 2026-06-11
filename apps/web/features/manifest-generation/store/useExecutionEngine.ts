"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * User-facing execution-engine override for the generate flows.
 *
 * "auto"  — resolve via resolveExecutionStrategy (cloud-first; local only
 *           when no cloud keys are configured).
 * "cloud" — force the server cloud pipeline.
 * "local" — force client-side WebLLM. Explicitly opting in here is what
 *           gates the pre-generate warning dialog — auto-resolved local
 *           (no cloud keys available) must NOT warn.
 */
export type ExecutionEngine = "auto" | "cloud" | "local";

interface ExecutionEngineState {
  engine: ExecutionEngine;
  setEngine: (engine: ExecutionEngine) => void;
}

export const useExecutionEngine = create<ExecutionEngineState>()(
  persist(
    (set) => ({
      engine: "auto",
      setEngine: (engine) => set({ engine }),
    }),
    { name: "execution-engine-storage" },
  ),
);

/**
 * The warning dialog fires only for the explicit local override — never for
 * auto, even when auto will resolve to local (no cloud keys). The user who
 * never touched the selector should not be interrupted.
 */
export function shouldWarnBeforeGenerate(engine: ExecutionEngine): boolean {
  return engine === "local";
}

/**
 * Maps the engine override onto the boolean `preferLocal` channel used by
 * useStagedManifestGeneration. "auto" defers to the readiness-derived value
 * (local only when no cloud keys but WebLLM hardware is present).
 */
export function effectivePreferLocal(
  engine: ExecutionEngine,
  readinessPreferLocal: boolean,
): boolean {
  if (engine === "local") return true;
  if (engine === "cloud") return false;
  return readinessPreferLocal;
}
