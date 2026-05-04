import { useState, useCallback } from "react";
import type { CloudConnectionState } from "../types";

export function useCloudConnectivity(
  isConnecting?: boolean,
  connectionError?: string | null,
) {
  const [internalError, setInternalError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setInternalError(null);
  }, []);

  const setError = useCallback((error: string) => {
    setInternalError(error);
  }, []);

  const getState = useCallback((): CloudConnectionState => {
    return {
      connected: !connectionError && !internalError,
      loading: isConnecting ?? false,
      error: connectionError || internalError || undefined,
    };
  }, [isConnecting, connectionError, internalError]);

  return {
    state: getState(),
    clearError,
    setError,
    isConnected: !connectionError && !internalError,
  };
}
