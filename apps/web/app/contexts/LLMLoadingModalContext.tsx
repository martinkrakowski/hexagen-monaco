"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface LLMLoadingModalContextValue {
  isSuppressed: boolean;
  suppress: () => void;
  restore: () => void;
}

const LLMLoadingModalContext =
  createContext<LLMLoadingModalContextValue | null>(null);

export function LLMLoadingModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isSuppressed, setIsSuppressed] = useState(false);
  const suppress = useCallback(() => setIsSuppressed(true), []);
  const restore = useCallback(() => setIsSuppressed(false), []);

  return (
    <LLMLoadingModalContext.Provider
      value={{ isSuppressed, suppress, restore }}
    >
      {children}
    </LLMLoadingModalContext.Provider>
  );
}

/**
 * Call this in any component that manages its own WebLLM loading modal.
 * Suppresses the layout-level modal for the lifetime of the calling component.
 */
export function useSuppressLLMLoadingModal() {
  const ctx = useContext(LLMLoadingModalContext);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    ctxRef.current?.suppress();
    return () => ctxRef.current?.restore();
  }, []);
}

export function useLLMLoadingModalSuppressed(): boolean {
  const ctx = useContext(LLMLoadingModalContext);
  return ctx?.isSuppressed ?? false;
}
