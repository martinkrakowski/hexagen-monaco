"use client";

import { useEffect, useState } from "react";
import type { HardwareProfile } from "@hexagen/local-llm";
import { getHardwareProfiler } from "@/lib/wire";

/**
 * sessionStorage key for cached hardware profile
 */
const HARDWARE_PROFILE_CACHE_KEY = "hexagen:local-llm:hardware-profile";

/**
 * useHardwareDetection: React hook for hardware capability detection
 *
 * - Detects on mount (once per session via sessionStorage)
 * - Caches result in sessionStorage to avoid repeated detection
 * - Fresh page load = fresh detection
 * - Same session/tab = reused result
 *
 * Returns:
 * - profile: HardwareProfile | null (null = detection still pending or failed)
 * - isDetecting: boolean (true while detection is in progress)
 * - error: string | null (error message if detection failed)
 */
export function useHardwareDetection() {
  const [profile, setProfile] = useState<HardwareProfile | null>(null);
  const [isDetecting, setIsDetecting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Try to load from sessionStorage first
    try {
      const cached = sessionStorage.getItem(HARDWARE_PROFILE_CACHE_KEY);
      if (cached) {
        const profile: HardwareProfile = JSON.parse(cached);
        setProfile(profile);
        setIsDetecting(false);
        return; // Use cached result
      }
    } catch (err) {
      // SessionStorage unavailable (private browsing, storage quota exceeded, etc.)
      // Fall through to fresh detection — this is not a fatal error
      console.warn("[useHardwareDetection] sessionStorage read failed:", err);
    }

    // Run detection if not cached
    const detect = async () => {
      try {
        const profiler = getHardwareProfiler();
        const result = await profiler.profile();

        if (result.success) {
          setProfile(result.value);

          // Cache the result
          try {
            sessionStorage.setItem(
              HARDWARE_PROFILE_CACHE_KEY,
              JSON.stringify(result.value),
            );
          } catch (storageErr) {
            // Cache write failure — detection succeeded, caching failed.
            // Detection is the primary concern; log and continue.
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
  }, []);

  return { profile, isDetecting, error };
}
