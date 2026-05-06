"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { DomainModelId, LLMEngineState } from "@hexagen/local-llm";
import { DEFAULT_MODEL_ID } from "@hexagen/local-llm";

import {
  AUTO_LOAD_KEY,
  HAS_ENABLED_KEY,
  readAndMigrateLastModelId,
} from "./storage-keys";

interface UseAutoInitLastModelOptions {
  engineState: LLMEngineState;
  setEngineState: Dispatch<SetStateAction<LLMEngineState>>;
  initializeModel: (modelId?: DomainModelId) => Promise<void>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
}

/**
 * Opt-in + auto-load effect. Fires once when engineState transitions
 * to "opt_in" (immediately after WebGPU detection resolves). Three
 * mutually-exclusive branches:
 *
 *   1. AUTO_LOAD_KEY=true: user previously completed a successful
 *      load. Restore the last-used model (with legacy-id migration)
 *      and auto-initialize it, BUT only if that model is still in the
 *      IndexedDB cache. If not cached, clear AUTO_LOAD_KEY and route
 *      to "requires_model" so the user picks explicitly — silently
 *      re-downloading a multi-GB model behind a spinner is unacceptable.
 *
 *   2. HAS_ENABLED_KEY set but AUTO_LOAD_KEY unset: user opted in but
 *      subsequently cancelled or cleared cache. Route to
 *      "requires_model" so the UI shows the model-selection screen
 *      instead of stranding the user on the opt-in hold spinner.
 *
 *   3. Neither flag set: first-time user. Route to "requires_model"
 *      (the model-settings view) so they choose a model explicitly.
 *
 * The `hasAttemptedAutoInitRef` guards against the effect re-running
 * when dependencies change. Once we transition, the branch is done.
 */
export function useAutoInitLastModel({
  engineState,
  setEngineState,
  initializeModel,
  hasModelInCache,
}: UseAutoInitLastModelOptions): void {
  const hasAttemptedAutoInitRef = useRef(false);

  useEffect(() => {
    if (hasAttemptedAutoInitRef.current) return;
    if (engineState.status !== "opt_in") return;

    if (localStorage.getItem(AUTO_LOAD_KEY) === "true") {
      const lastModel = readAndMigrateLastModelId();
      const modelToLoad = lastModel ?? DEFAULT_MODEL_ID;

      hasAttemptedAutoInitRef.current = true;

      const CACHE_TIMEOUT_MS = 10_000; // Increased from 5s to allow for slower IndexedDB

      // Use a sentinel value to distinguish between timeout and "not cached":
      // 1. undefined = timeout occurred
      // 2. true/false = cache check completed successfully
      const timeoutSentinel = Symbol("cache-check-timeout");
      const cacheCheckWithTimeout = Promise.race([
        hasModelInCache(modelToLoad)
          .then((result) => result) // Cache check completed
          .catch(() => false), // Cache check failed
        new Promise<symbol>((resolve) =>
          setTimeout(() => resolve(timeoutSentinel), CACHE_TIMEOUT_MS),
        ),
      ]);

      cacheCheckWithTimeout.then((result) => {
        if (result === timeoutSentinel) {
          // Timeout occurred — assume cached and attempt init.
          // If the model truly isn't cached, initializeModel will fail
          // gracefully and clear the keys then.
          setEngineState((prev) => ({ ...prev, autoLoading: true }));
          initializeModel(modelToLoad);
        } else if (result === true) {
          // Cache check confirmed model is cached — initialize
          setEngineState((prev) => ({ ...prev, autoLoading: true }));
          initializeModel(modelToLoad);
        } else {
          // Cache check confirmed model is NOT cached —
          // route to requires_model and clear AUTO_LOAD_KEY
          localStorage.removeItem(AUTO_LOAD_KEY);
          setEngineState((prev) => ({
            ...prev,
            status: "requires_model",
            autoLoading: false,
          }));
        }
      });
    } else if (localStorage.getItem(HAS_ENABLED_KEY) !== null) {
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
  }, [engineState.status, initializeModel, hasModelInCache, setEngineState]);
}
