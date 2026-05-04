/**
 * Pure Finite State Machine for Cloud LLM connection lifecycle.
 *
 * States: IDLE -> CONNECTING -> CONNECTED | ERROR
 *
 * This is a pure domain object with no side effects, no async operations,
 * and no infrastructure dependencies. It only computes state transitions.
 */

export type ConnectionState = "idle" | "connecting" | "connected" | "error";

export interface ConnectionError {
  message: string;
  retryable: boolean;
  retryCount: number;
}

export interface CloudConnectionMachineState {
  state: ConnectionState;
  error: ConnectionError | null;
}

export const CONNECTION_TIMEOUT_MS = 10000;
export const MAX_RETRY_ATTEMPTS = 3;
export const BASE_RETRY_DELAY_MS = 1000;

export function calculateRetryDelay(attemptNumber: number): number {
  return BASE_RETRY_DELAY_MS * Math.pow(2, attemptNumber);
}

export function createInitialMachineState(): CloudConnectionMachineState {
  return {
    state: "idle",
    error: null,
  };
}

export function transitionToConnecting(): CloudConnectionMachineState {
  return {
    state: "connecting",
    error: null,
  };
}

export function transitionToConnected(): CloudConnectionMachineState {
  return {
    state: "connected",
    error: null,
  };
}

export function transitionToError(
  currentState: CloudConnectionMachineState,
  errorMessage: string,
  retryCount: number,
): CloudConnectionMachineState {
  return {
    state: "error",
    error: {
      message: errorMessage,
      retryable: retryCount < MAX_RETRY_ATTEMPTS,
      retryCount,
    },
  };
}

export function transitionToIdle(): CloudConnectionMachineState {
  return {
    state: "idle",
    error: null,
  };
}

export function shouldRetry(error: ConnectionError | null): boolean {
  return error?.retryable ?? false;
}

export function getNextRetryCount(error: ConnectionError | null): number {
  return (error?.retryCount ?? 0) + 1;
}
