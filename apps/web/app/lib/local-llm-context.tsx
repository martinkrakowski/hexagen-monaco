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
  LLMRequest,
  ModelMetadata,
} from "@hexagen/local-llm";
import { LLM_ENGINE_INITIAL_STATE } from "@hexagen/local-llm";
import { resetLocalAIConfig as sharedResetLocalAIConfig } from "@hexagen/shared";

import { useEngineLifecycle } from "./local-llm/useEngineLifecycle";
import { useModelCache } from "./local-llm/useModelCache";
import { useAutoInitLastModel } from "./local-llm/useAutoInitLastModel";
import { useGovernancePayload } from "./local-llm/useGovernancePayload";
import { useChatMessages } from "./local-llm/useChatMessages";

export type { ChatMessage };
export { AUTO_LOAD_KEY, HAS_ENABLED_KEY } from "./local-llm/storage-keys";

interface LocalLLMConfigValue {
  engineState: LLMEngineState;
  loadedModel: ModelMetadata | null;
  initializeModel: (modelId?: DomainModelId) => Promise<void>;
  cancelDownload: () => void;
  enterRequiresModel: () => void;
  clearError: () => void;
  switchModel: (modelId: DomainModelId) => Promise<void>;
  deleteCachedModel: (modelId: DomainModelId) => Promise<void>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
  hasAnyCachedModel: () => Promise<boolean>;
  returnToModelSettings: () => void;
  resetLocalAIConfig: () => string[];
}

interface LocalLLMStreamingValue {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<void>;
  sendGovernanceMessage: (
    content: string,
    systemPrompt: string,
    history?: LLMRequest["messages"],
  ) => Promise<void>;
  sendStructuredPrompt: (
    userPrompt: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ) => Promise<string>;
}

interface LocalLLMContextValue
  extends LocalLLMConfigValue, LocalLLMStreamingValue {}

const LocalLLMConfigContext = createContext<LocalLLMConfigValue | undefined>(
  undefined,
);

const LocalLLMStreamingContext = createContext<
  LocalLLMStreamingValue | undefined
>(undefined);

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

  const resetConfig = (): string[] => {
    const clearedKeys = sharedResetLocalAIConfig();
    clearMessagesRef.current();
    engine.adapterRef.current?.dispose();
    return clearedKeys;
  };

  const cache = useModelCache(engine.adapterRef);

  useAutoInitLastModel({
    engineState: engine.engineState,
    setEngineState: engine.setEngineStateForAutoInit,
    initializeModel: engine.initializeModel,
  });

  const { governancePayload, editorStateRef } = useGovernancePayload();

  const chat = useChatMessages({
    adapterRef: engine.adapterRef,
    governancePayload,
    editorStateRef,
  });

  clearMessagesRef.current = chat.clearMessages;

  const configValue = useMemo<LocalLLMConfigValue>(
    () => ({
      engineState: engine.engineState,
      loadedModel: engine.loadedModel,
      initializeModel: engine.initializeModel,
      cancelDownload: engine.cancelDownload,
      enterRequiresModel: engine.enterRequiresModel,
      clearError: engine.clearError,
      switchModel: engine.switchModel,
      deleteCachedModel: engine.deleteCachedModel,
      hasModelInCache: cache.hasModelInCache,
      hasAnyCachedModel: cache.hasAnyCachedModel,
      returnToModelSettings: engine.returnToModelSettings,
      resetLocalAIConfig: resetConfig,
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
      cache.hasModelInCache,
      cache.hasAnyCachedModel,
    ],
  );

  const streamingValue = useMemo<LocalLLMStreamingValue>(
    () => ({
      messages: chat.messages,
      isStreaming: chat.isStreaming,
      sendMessage: chat.sendMessage,
      sendGovernanceMessage: chat.sendGovernanceMessage,
      sendStructuredPrompt: chat.sendStructuredPrompt,
    }),
    [
      chat.messages,
      chat.isStreaming,
      chat.sendMessage,
      chat.sendGovernanceMessage,
      chat.sendStructuredPrompt,
    ],
  );

  // Render the same provider tree regardless of `mounted`; only the context
  // *values* change once mounted. Previously this swapped the element wrapping
  // {children} from a host <div> (pre-mount) to the context providers
  // (post-mount). Changing the element type at that position forces React to
  // unmount and remount the entire subtree, double-mounting every page on first
  // load. Keeping the structure stable makes the mount→mounted transition a
  // plain re-render. Pre-mount we hand out the inert fallbacks so the server and
  // first client render produce identical output (no hydration mismatch).
  return (
    <LocalLLMConfigContext.Provider
      value={mounted ? configValue : CONFIG_FALLBACK}
    >
      <LocalLLMStreamingContext.Provider
        value={mounted ? streamingValue : STREAMING_FALLBACK}
      >
        {children}
      </LocalLLMStreamingContext.Provider>
    </LocalLLMConfigContext.Provider>
  );
}

const CONFIG_FALLBACK: LocalLLMConfigValue = {
  engineState: LLM_ENGINE_INITIAL_STATE,
  loadedModel: null,
  initializeModel: async () => {},
  cancelDownload: () => {},
  enterRequiresModel: () => {},
  clearError: () => {},
  switchModel: async () => {},
  deleteCachedModel: async () => {},
  hasModelInCache: async () => false,
  hasAnyCachedModel: async () => false,
  returnToModelSettings: () => {},
  resetLocalAIConfig: () => [],
};

const STREAMING_FALLBACK: LocalLLMStreamingValue = {
  messages: [],
  isStreaming: false,
  sendMessage: async () => {},
  sendGovernanceMessage: async () => {},
  sendStructuredPrompt: async () => {
    throw new Error("Not mounted");
  },
};

export function useLocalLLMConfig(): LocalLLMConfigValue {
  const context = useContext(LocalLLMConfigContext);
  const mounted = useSyncExternalStore(
    subscribeMounted,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  if (!context) {
    if (mounted) {
      throw new Error(
        "useLocalLLMConfig must be used within a LocalLLMProvider",
      );
    }
    return CONFIG_FALLBACK;
  }
  return context;
}

export function useLocalLLMStreaming(): LocalLLMStreamingValue {
  const context = useContext(LocalLLMStreamingContext);
  const mounted = useSyncExternalStore(
    subscribeMounted,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  if (!context) {
    if (mounted) {
      throw new Error(
        "useLocalLLMStreaming must be used within a LocalLLMProvider",
      );
    }
    return STREAMING_FALLBACK;
  }
  return context;
}

export function useLocalLLM(): LocalLLMContextValue {
  const config = useLocalLLMConfig();
  const streaming = useLocalLLMStreaming();

  return useMemo(() => ({ ...config, ...streaming }), [config, streaming]);
}
