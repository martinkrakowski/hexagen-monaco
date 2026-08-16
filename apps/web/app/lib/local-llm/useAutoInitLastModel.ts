"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { DomainModelId, LLMEngineState } from "@hexagen/local-llm";
import { DEFAULT_MODEL_ID } from "@hexagen/local-llm";

import { readAndMigrateLastModelId } from "./storage-keys";
import { getAutoLoadEnabled, getHasEnabledLocalModels } from "@hexagen/shared";

interface UseAutoInitLastModelOptions {
  engineState: LLMEngineState;
  setEngineState: Dispatch<SetStateAction<LLMEngineState>>;
  initializeModel: (modelId?: DomainModelId) => Promise<void>;
}

/**
 * Opt-in + auto-load effect. Fires once when engineState transitions
 * to "opt_in" (immediately after WebGPU detection resolves). Three
 * mutually-exclusive branches:
 *
 * 1. AUTO_LOAD_KEY=true: user previously completed a successful
 * load. Restore the last-used model (with legacy-id migration)
 * and auto-initialize it unconditionally. If the model is cached
 * in IndexedDB, it loads from cache (fast). If not cached, it
 * re-downloads — this is acceptable because the user explicitly
 * opted in and the cache check (via temp worker + dynamic import)
 * is unreliable. If init fails, initializeModel clears the keys
 * and routes to error state.
 *
 * 2. HAS_ENABLED_KEY set but AUTO_LOAD_KEY unset: user opted in but
 * subsequently cancelled or cleared cache. Route to
 * "requires_model" so the UI shows the model-selection screen
 * instead of stranding the user on the opt-in hold spinner.
 *
 * 3. Neither flag set: first-time user. Route to "requires_model"
 * (the model-settings view) so they choose a model explicitly.
 *
 * The `hasAttemptedAutoInitRef` guards against the effect re-running
 * when dependencies change. Once we transition, the branch is done.
 */
export function useAutoInitLastModel({
  engineState,
  setEngineState,
  initializeModel,
}: UseAutoInitLastModelOptions): void {
  const hasAttemptedAutoInitRef = useRef(false);

  useEffect(() => {
    if (hasAttemptedAutoInitRef.current) return;
    if (engineState.status !== "opt_in") return;

    if (getAutoLoadEnabled()) {
      const lastModel = readAndMigrateLastModelId();
      const modelToLoad = lastModel ?? DEFAULT_MODEL_ID;

      hasAttemptedAutoInitRef.current = true;
      setEngineState((prev) => ({ ...prev, autoLoading: true }));
      initializeModel(modelToLoad);
    } else if (getHasEnabledLocalModels()) {
      hasAttemptedAutoInitRef.current = true;
      setEngineState((prev) => ({
        ...prev,
        status: "requires_model",
        autoLoading: false,
      }));
    } else {
      hasAttemptedAutoInitRef.current = true;
      setEngineState((prev) => ({
        ...prev,
        status: "requires_model",
        autoLoading: false,
      }));
    }
  }, [engineState.status, initializeModel, setEngineState]);
}
