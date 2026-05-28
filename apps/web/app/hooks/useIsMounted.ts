"use client";

import { useEffect, useState } from "react";

/**
 * Custom hook to detect if a component has mounted on the client-side.
 * Serves as a semantic wrapper to suppress SSR hydration mismatches.
 */
export function useIsMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
