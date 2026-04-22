"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  ChatMessage,
  DomainModelId,
  LLMEngineState,
  ModelMetadata,
} from "@hexagen/local-llm";
import type { LLMRequest } from "@hexagen/local-llm";
import { LLM_ENGINE_INITIAL_STATE } from "@hexagen/local-llm";

import { useEngineLifecycle } from "./local-llm/useEngineLifecycle";
import { useModelCache } from "./local-llm/useModelCache";
import { useAutoInitLastModel } from "./local-llm/useAutoInitLastModel";
import { useGovernancePayload } from "./local-llm/useGovernancePayload";
import { useChatMessages } from "./local-llm/useChatMessages";

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
    history?: LLMRequest["messages"],
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

let mountedState = false;
const mountedListeners = new Set<() => void>();

function subscribeMounted(callback: () => void) {
  mountedListeners.add(callback);
  return () => mountedListeners.delete(callback);
}

function getMountedSnapshot() {
  return mountedState;
}

function getMountedServerSnapshot() {
  return false;
}

export function LocalLLMProvider({ children }: LocalLLMProviderProps) {
  const mounted = useSyncExternalStore(
    subscribeMounted,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  useEffect(() => {
    mountedState = true;
    for (const cb of mountedListeners) cb();
  }, []);

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

export function useLocalLLM(): LocalLLMContextValue {
  const context = useContext(LocalLLMContext);
  const mounted = useSyncExternalStore(
    subscribeMounted,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  if (!context) {
    if (mounted) {
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
