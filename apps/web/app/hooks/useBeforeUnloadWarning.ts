import { useEffect, useCallback, useRef } from "react";

export interface UseBeforeUnloadWarningReturn {
  enableWarning: () => void;
  disableWarning: () => void;
}

interface UseBeforeUnloadWarningOptions {
  hasDraft: boolean;
  hasGenerated: boolean;
}

export function useBeforeUnloadWarning({
  hasDraft,
  hasGenerated,
}: UseBeforeUnloadWarningOptions): UseBeforeUnloadWarningReturn {
  const shouldWarnRef = useRef(false);

  useEffect(() => {
    shouldWarnRef.current = hasDraft && !hasGenerated;
  }, [hasDraft, hasGenerated]);

  const handleBeforeUnload = useCallback((e: BeforeUnloadEvent) => {
    if (!shouldWarnRef.current) return;
    e.preventDefault();
    e.returnValue = "";
    return "";
  }, []);

  useEffect(() => {
    if (shouldWarnRef.current) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    }
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [handleBeforeUnload]);

  const enableWarning = useCallback(() => {
    shouldWarnRef.current = true;
  }, []);

  const disableWarning = useCallback(() => {
    shouldWarnRef.current = false;
  }, []);

  return { enableWarning, disableWarning };
}
