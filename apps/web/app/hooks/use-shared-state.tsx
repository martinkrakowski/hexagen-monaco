"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";

export interface CodeChangeEvent {
  type: "code-change";
  content: string;
  timestamp: number;
  source: "monaco" | "wizard" | "visualization" | "ai-agent";
  sessionId?: string;
}

export interface WizardChangeEvent {
  type: "wizard-change";
  data: unknown;
  timestamp: number;
}

export type ApplicationEvent = CodeChangeEvent | WizardChangeEvent;

interface SharedStateContextValue {
  events: ApplicationEvent[];
  lastCodeChange: CodeChangeEvent | null;
  lastWizardChange: WizardChangeEvent | null;
  subscribe: (callback: (event: ApplicationEvent) => void) => () => void;
  emitCodeChange: (event: Omit<CodeChangeEvent, "timestamp">) => void;
  emitWizardChange: (event: Omit<WizardChangeEvent, "timestamp">) => void;
  clearEvents: () => void;
}

const SharedStateContext = createContext<SharedStateContextValue | undefined>(
  undefined,
);

interface SharedStateProviderProps {
  children: ReactNode;
}

export function SharedStateProvider({ children }: SharedStateProviderProps) {
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [lastCodeChange, setLastCodeChange] = useState<CodeChangeEvent | null>(
    null,
  );
  const [lastWizardChange, setLastWizardChange] = useState<WizardChangeEvent | null>(
    null,
  );
  const [subscribers, setSubscribers] = useState<
    Set<(event: ApplicationEvent) => void>
  >(new Set());

  const subscribe = useCallback((callback: (event: ApplicationEvent) => void) => {
    setSubscribers((prev) => {
      const next = new Set(prev);
      next.add(callback);
      return next;
    });

    return () => {
      setSubscribers((prev) => {
        const next = new Set(prev);
        next.delete(callback);
        return next;
      });
    };
  }, []);

  const emitEvent = useCallback((event: ApplicationEvent) => {
    setEvents((prev) => [...prev, event]);

    if (event.type === "code-change") {
      setLastCodeChange(event as CodeChangeEvent);
    } else if (event.type === "wizard-change") {
      setLastWizardChange(event as WizardChangeEvent);
    }

    setSubscribers((prev) => {
      prev.forEach((callback) => {
        try {
          callback(event);
        } catch {
          // subscriber threw, ignore
        }
      });
      return prev;
    });
  }, []);

  const emitCodeChange = useCallback(
    (event: Omit<CodeChangeEvent, "timestamp">) => {
      emitEvent({ ...event, timestamp: Date.now() });
    },
    [emitEvent],
  );

  const emitWizardChange = useCallback(
    (event: Omit<WizardChangeEvent, "timestamp">) => {
      emitEvent({ ...event, timestamp: Date.now() });
    },
    [emitEvent],
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return (
    <SharedStateContext.Provider
      value={{
        events,
        lastCodeChange,
        lastWizardChange,
        subscribe,
        emitCodeChange,
        emitWizardChange,
        clearEvents,
      }}
    >
      {children}
    </SharedStateContext.Provider>
  );
}

export function useSharedState(): SharedStateContextValue {
  const context = useContext(SharedStateContext);
  if (!context) {
    throw new Error(
      "useSharedState must be used within a SharedStateProvider",
    );
  }
  return context;
}

export function useCodeChangeSubscription(
  callback: (event: CodeChangeEvent) => void,
  deps: React.DependencyList = [],
) {
  const { subscribe } = useSharedState();

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type === "code-change") {
        callback(event);
      }
    });
    return unsubscribe;
  }, [subscribe, ...deps]);
}

export function useWizardChangeSubscription(
  callback: (event: WizardChangeEvent) => void,
  deps: React.DependencyList = [],
) {
  const { subscribe } = useSharedState();

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type === "wizard-change") {
        callback(event);
      }
    });
    return unsubscribe;
  }, [subscribe, ...deps]);
}