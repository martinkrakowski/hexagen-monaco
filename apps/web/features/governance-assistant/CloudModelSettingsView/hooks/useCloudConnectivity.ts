import { useState, useCallback, useMemo } from "react";

export function useCloudConnectivity(
  isConnecting?: boolean,
  connectionError?: string | null,
  isConnectedProp?: boolean,
) {
  const [internalError, setInternalError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setInternalError(null);
  }, []);

  const setError = useCallback((error: string) => {
    setInternalError(error);
  }, []);

  const isConnected = isConnectedProp ?? (!connectionError && !internalError);

  return useMemo(
    () => ({
      state: {
        connected: isConnected,
        loading: isConnecting ?? false,
        error: connectionError || internalError || undefined,
      },
      clearError,
      setError,
      isConnected,
    }),
    [
      isConnected,
      isConnecting,
      connectionError,
      internalError,
      clearError,
      setError,
    ],
  );
}
