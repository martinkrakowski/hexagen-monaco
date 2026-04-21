"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { HardwareProfile } from "@hexagen/local-llm";
import { getHardwareProfiler } from "@/lib/wire";

const HARDWARE_PROFILE_CACHE_KEY = "hexagen:local-llm:hardware-profile";

let cachedSnapshot: string | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const cb of listeners) cb();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getServerSnapshot() {
  return null;
}

function getSnapshot(): string | null {
  if (cachedSnapshot === null) {
    try {
      cachedSnapshot = sessionStorage.getItem(HARDWARE_PROFILE_CACHE_KEY);
    } catch {
      cachedSnapshot = null;
    }
  }
  return cachedSnapshot;
}

export function useHardwareDetection() {
  const cachedJson = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [profile, setProfile] = useState<HardwareProfile | null>(null);
  const [isDetecting, setIsDetecting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedJson) {
      try {
        const parsed: HardwareProfile = JSON.parse(cachedJson);
        setProfile(parsed);
        setIsDetecting(false);
        return;
      } catch {
        // Fall through to fresh detection
      }
    }

    const detect = async () => {
      try {
        const profiler = getHardwareProfiler();
        const result = await profiler.profile();

        if (result.success) {
          setProfile(result.value);

          try {
            const serialized = JSON.stringify(result.value);
            sessionStorage.setItem(HARDWARE_PROFILE_CACHE_KEY, serialized);
            cachedSnapshot = serialized;
            emitChange();
          } catch (storageErr) {
            console.warn(
              "[useHardwareDetection] sessionStorage write failed:",
              storageErr,
            );
          }
        } else {
          setError(
            result.error instanceof Error
              ? result.error.message
              : "Unknown hardware detection error",
          );
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to detect hardware",
        );
      } finally {
        setIsDetecting(false);
      }
    };

    detect();
  }, [cachedJson]);

  return { profile, isDetecting, error };
}
