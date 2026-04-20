"use client";

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface CodeChangeEvent {
  type: "code-change";
  content: string;
  timestamp: number;
  source: "monaco" | "wizard" | "visualization" | "ai-agent";
  sessionId?: string;
}

export type ApplicationEvent = CodeChangeEvent;

type Subscriber = (event: ApplicationEvent) => void;

// ---------------------------------------------------------------------------
// Context value — stable references only, no state that causes re-renders
// ---------------------------------------------------------------------------

interface SharedStateContextValue {
  /** Register a listener. Returns an unsubscribe function. */
  subscribe: (callback: Subscriber) => () => void;
  /** Emit a code-change event to all subscribers. */
  emitCodeChange: (event: Omit<CodeChangeEvent, "timestamp">) => void;
}

const SharedStateContext = createContext<SharedStateContextValue | undefined>(
  undefined,
);

// ---------------------------------------------------------------------------
// Provider — useRef-backed, zero re-renders on emit
// ---------------------------------------------------------------------------

interface SharedStateProviderProps {
  children: ReactNode;
}

export function SharedStateProvider({ children }: SharedStateProviderProps) {
  const subscribersRef = useRef<Set<Subscriber>>(new Set());

  const subscribe = useCallback((callback: Subscriber) => {
    subscribersRef.current.add(callback);
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  const emitCodeChange = useCallback(
    (event: Omit<CodeChangeEvent, "timestamp">) => {
      const fullEvent: CodeChangeEvent = { ...event, timestamp: Date.now() };
      subscribersRef.current.forEach((callback) => {
        try {
          callback(fullEvent);
        } catch {
          // subscriber threw — swallow to protect other listeners
        }
      });
    },
    [],
  );

  // Stable object reference — never changes, never triggers consumer re-renders
  const value = useMemo(
    () => ({ subscribe, emitCodeChange }),
    [subscribe, emitCodeChange],
  );

  return (
    <SharedStateContext.Provider value={value}>
      {children}
    </SharedStateContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useSharedState(): SharedStateContextValue {
  const context = useContext(SharedStateContext);
  if (!context) {
    throw new Error("useSharedState must be used within a SharedStateProvider");
  }
  return context;
}

/**
 * Subscribe to code-change events. The callback fires synchronously
 * when any component calls `emitCodeChange`.
 */
export function useCodeChangeSubscription(callback: Subscriber) {
  const { subscribe } = useSharedState();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const handler: Subscriber = (event) => callbackRef.current(event);
    return subscribe(handler);
  }, [subscribe]);
}
