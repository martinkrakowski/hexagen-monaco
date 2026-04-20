"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  ChatMessage,
  DomainModelId,
  LLMMessage,
  LLMEngineState,
  ModelMetadata,
} from "@hexagen/local-llm";
import { LLM_ENGINE_INITIAL_STATE } from "@hexagen/local-llm";

import { useEngineLifecycle } from "./local-llm/useEngineLifecycle";
import { useModelCache } from "./local-llm/useModelCache";
import { useAutoInitLastModel } from "./local-llm/useAutoInitLastModel";
import { useGovernancePayload } from "./local-llm/useGovernancePayload";
import { useChatMessages } from "./local-llm/useChatMessages";

// Re-export for backward compatibility with existing consumers.
export type { ChatMessage };
export { AUTO_LOAD_KEY, HAS_ENABLED_KEY } from "./local-llm/storage-keys";

interface LocalLLMContextValue {
  engineState: LLMEngineState;
  messages: ChatMessage[];
  isStreaming: boolean;
  loadedModel: ModelMetadata | null;
  initializeModel: (modelId?: DomainModelId) => Promise<void>;
  cancelDownload: () => void;
  enterRequiresModel: () => void;
  sendMessage: (content: string) => Promise<void>;
  sendGovernanceMessage: (
    content: string,
    systemPrompt: string,
    history?: LLMMessage[],
  ) => Promise<void>;
  clearError: () => void;
  switchModel: (modelId: DomainModelId) => Promise<void>;
  deleteCachedModel: (modelId: DomainModelId) => Promise<void>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
  hasAnyCachedModel: () => Promise<boolean>;
  returnToModelSettings: () => void;
}

const LocalLLMContext = createContext<LocalLLMContextValue | undefined>(
  undefined,
);

interface LocalLLMProviderProps {
  children: ReactNode;
}

/**
 * Composition root for the local LLM subsystem. Wires together five
 * focused hooks (engine lifecycle, model cache, auto-init effect,
 * governance payload, chat messages) and exposes their combined API
 * via React Context.
 *
 * Each concern lives in its own hook under ./local-llm/:
 *   - useEngineLifecycle: engineState + init/switch/cancel/delete
 *   - useModelCache: stateless adapter-cache queries
 *   - useAutoInitLastModel: opt-in + auto-load effect
 *   - useGovernancePayload: /api/llm/context fetch + editor subscription
 *   - useChatMessages: messages + persistence + send methods
 */
export function LocalLLMProvider({ children }: LocalLLMProviderProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Chat messages need to be cleared when the engine performs a
  // destructive transition (switchModel / deleteCachedModel of the
  // currently-loaded model). Wire the clear callback into the engine
  // via a placeholder ref-style function — the real clearMessages
  // comes from useChatMessages below.
  const clearMessagesRef = { current: () => {} };

  const engine = useEngineLifecycle({
    onMessagesClear: () => clearMessagesRef.current(),
  });

  const cache = useModelCache(engine.adapterRef);

  useAutoInitLastModel({
    engineState: engine.engineState,
    setEngineState: engine.setEngineStateForAutoInit,
    initializeModel: engine.initializeModel,
    hasModelInCache: cache.hasModelInCache,
  });

  const { governancePayload, editorStateRef } = useGovernancePayload();

  const chat = useChatMessages({
    adapterRef: engine.adapterRef,
    governancePayload,
    editorStateRef,
  });

  clearMessagesRef.current = chat.clearMessages;

  // Memoized context value — only changes when a consumed value or
  // callback identity changes. Prevents consumer re-render storms.
  const value = useMemo<LocalLLMContextValue>(
    () => ({
      engineState: engine.engineState,
      messages: chat.messages,
      isStreaming: chat.isStreaming,
      loadedModel: engine.loadedModel,
      initializeModel: engine.initializeModel,
      cancelDownload: engine.cancelDownload,
      enterRequiresModel: engine.enterRequiresModel,
      sendMessage: chat.sendMessage,
      sendGovernanceMessage: chat.sendGovernanceMessage,
      clearError: engine.clearError,
      switchModel: engine.switchModel,
      deleteCachedModel: engine.deleteCachedModel,
      hasModelInCache: cache.hasModelInCache,
      hasAnyCachedModel: cache.hasAnyCachedModel,
      returnToModelSettings: engine.returnToModelSettings,
    }),
    [
      engine.engineState,
      engine.loadedModel,
      engine.initializeModel,
      engine.cancelDownload,
      engine.enterRequiresModel,
      engine.clearError,
      engine.switchModel,
      engine.deleteCachedModel,
      engine.returnToModelSettings,
      chat.messages,
      chat.isStreaming,
      chat.sendMessage,
      chat.sendGovernanceMessage,
      cache.hasModelInCache,
      cache.hasAnyCachedModel,
    ],
  );

  // SSR / hydration guard — render children without a provider value
  // during SSR so components don't throw during server render.
  if (!mounted) {
    return (
      <div className="contents" suppressHydrationWarning>
        {children}
      </div>
    );
  }

  return (
    <LocalLLMContext.Provider value={value}>
      {children}
    </LocalLLMContext.Provider>
  );
}

/**
 * Consumer hook for the LocalLLMContext.
 *
 * SSR-safe: returns a no-op default during server render and during
 * the brief window between SSR and client mount when the provider
 * may not be hydrated yet. Throws only AFTER mount, when missing
 * context signals a real provider-chain bug rather than a hydration
 * race.
 *
 * This guard was added after a rename-sweep regression that caused
 * consumers to see undefined context during hydration and cascade
 * the whole page into an empty Loader2. Removing it would regress
 * that fix.
 */
export function useLocalLLM(): LocalLLMContextValue {
  const context = useContext(LocalLLMContext);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!context) {
    if (isMounted) {
      throw new Error("useLocalLLM must be used within a LocalLLMProvider");
    }
    return {
      engineState: LLM_ENGINE_INITIAL_STATE,
      messages: [],
      isStreaming: false,
      loadedModel: null,
      initializeModel: async () => {},
      cancelDownload: () => {},
      enterRequiresModel: () => {},
      sendMessage: async () => {},
      sendGovernanceMessage: async () => {},
      clearError: () => {},
      switchModel: async () => {},
      deleteCachedModel: async () => {},
      hasModelInCache: async () => false,
      hasAnyCachedModel: async () => false,
      returnToModelSettings: () => {},
    };
  }
  return context;
}
