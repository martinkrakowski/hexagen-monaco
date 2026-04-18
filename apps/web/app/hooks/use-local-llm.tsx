"use client";

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  LocalLLMProviderPort,
  LLMMessage,
  LLMProgress,
  DomainModelId,
} from "@hexagen/local-llm";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_TUNING_CONFIG,
  parseDomainModelId,
} from "@hexagen/local-llm";
import type { WebGPUDetectorPort } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";
import type {
  LLMEngineState,
  LLMEngineStatus,
  ModelMetadata,
} from "@hexagen/local-llm";
import { LLM_ENGINE_INITIAL_STATE } from "@hexagen/local-llm";
import { getLocalLLMProvider, getWebGPUDetector } from "@/lib/wire";

import {
  buildGroundedSystemPrompt,
  chunkEditorBuffer,
  estimateTokens,
  prunedHistoryWindow,
  type GovernancePayload,
  type EditorState as EditorContextState,
} from "@/lib/grounded-prompt";
import { useEditor } from "@/contexts/EditorContext";

/**
 * localStorage key for remembering the last-used model ID.
 * Stores a DomainModelId enum value (e.g., "qwen-2.5-3b")
 */
const LAST_MODEL_KEY = "hexagen:local-llm:last-model";

/** localStorage key for the auto-load flag. */
const AUTO_LOAD_KEY = "hexagen:local-llm:auto-load";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface LocalLLMContextValue {
  engineState: LLMEngineState;
  messages: ChatMessage[];
  isStreaming: boolean;
  loadedModel: ModelMetadata | null;
  initializeModel: (modelId?: DomainModelId) => Promise<void>;
  cancelDownload: () => void;
  sendMessage: (content: string) => Promise<void>;
  sendGovernanceMessage: (
    content: string,
    systemPrompt: string,
  ) => Promise<void>;
  clearError: () => void;
  switchModel: (modelId: DomainModelId) => Promise<void>;
  deleteCachedModel: (modelId: DomainModelId) => Promise<void>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
}

const LocalLLMContext = createContext<LocalLLMContextValue | undefined>(
  undefined,
);

function deriveStatus(
  progress: LLMProgress | null,
  webgpuSupported: boolean,
  browserSupported: boolean,
): LLMEngineStatus {
  if (!webgpuSupported) return "no_webgpu";
  if (!browserSupported) return "unsupported_browser";
  if (!progress) return "opt_in";
  switch (progress.phase) {
    case "loading-model":
      return "downloading";
    case "compiling-shader":
    case "initializing-engine":
      return "loading_vram";
    case "ready":
      return "ready";
    case "error":
      return "error";
    default:
      return "downloading";
  }
}

function progressToStatus(phase: LLMProgress["phase"]): LLMEngineStatus {
  switch (phase) {
    case "ready":
      return "ready";
    case "error":
      return "error";
    case "compiling-shader":
    case "initializing-engine":
      return "loading_vram";
    case "loading-model":
    default:
      return "downloading";
  }
}

interface LocalLLMProviderProps {
  children: ReactNode;
}

export function LocalLLMProvider({ children }: LocalLLMProviderProps) {
  const adapterRef = useRef<LocalLLMProviderPort | null>(null);
  const webgpuRef = useRef<WebGPUDetectorPort | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isInitializingRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const cancelInitRef = useRef<(() => void) | null>(null);
  /** Guards against StrictMode double-fire and repeated auto-init attempts. */
  const hasAttemptedAutoInitRef = useRef(false);
  /**
   * Synchronous guard against concurrent streaming calls. `isStreaming` state
   * cannot serve this role because React batches state updates — two rapid
   * sendMessage calls would both observe `false` before the first
   * `setIsStreaming(true)` resolves. The ref is set synchronously at the top
   * of each send function and cleared in `finally`.
   */
  const isStreamingRef = useRef(false);

  const [engineState, setEngineState] = useState<LLMEngineState>(
    LLM_ENGINE_INITIAL_STATE,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [governancePayload, setGovernancePayload] =
    useState<GovernancePayload | null>(null);

  const [loadedModel, setLoadedModel] = useState<ModelMetadata | null>(null);

  useEffect(() => {
    if (
      engineState.status === "ready" ||
      engineState.status === "loading_vram"
    ) {
      setLoadedModel(adapterRef.current?.getLoadedModel() ?? null);
    } else {
      setLoadedModel(null);
    }
  }, [engineState.status, engineState.loadedModelId]);

  const { editorState } = useEditor();
  const editorStateRef = useRef<EditorContextState>(editorState);

  useEffect(() => {
    editorStateRef.current = editorState;
  }, [editorState]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const initializeModel = useCallback(
    async (modelId?: DomainModelId) => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      if (isInitializingRef.current) return;
      if (engineState.status === "ready" && adapter.getLoadedModel() !== null)
        return;

      const targetModelId = modelId ?? DEFAULT_MODEL_ID;
      isInitializingRef.current = true;
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: "downloading",
        progress: 0,
      }));

      const cancelPromise = new Promise<Result<void>>((_, reject) => {
        cancelInitRef.current = () => reject(new Error("download-cancelled"));
      });

      let initResult: Result<void>;
      try {
        initResult = await Promise.race([
          adapter.initialize(
            { modelId: targetModelId },
            (progress: LLMProgress) => {
              const text = (progress.text || "").toLowerCase();
              const isNetworkFetch =
                text.includes("fetching") &&
                !text.includes("loading model from cache");
              setEngineState((prev: LLMEngineState) => ({
                ...prev,
                status: progressToStatus(progress.phase),
                progress: progress.progress,
                // Only clear autoLoading when an actual network download is underway.
                // WebLLM fires "Fetching param cache[N/M]..." for network fetch (cache miss)
                // and "Loading model from cache[N/M]..." for a cache-to-GPU load (cache hit).
                // We must NOT clear on "Loading model from cache" — that is a warm cache hit.
                autoLoading: prev.autoLoading && !isNetworkFetch,
              }));
            },
          ),
          cancelPromise,
        ]);
      } catch {
        // Cancelled — terminate the worker, reset to opt_in, clear both flags
        // so a refresh doesn't re-trigger the failed/cancelled auto-init.
        localStorage.removeItem(AUTO_LOAD_KEY);
        localStorage.removeItem(LAST_MODEL_KEY);
        adapter.dispose();
        cancelInitRef.current = null;
        isInitializingRef.current = false;
        setEngineState((prev: LLMEngineState) => ({
          ...prev,
          status: "opt_in",
          progress: 0,
          errorMessage: null,
          autoLoading: false,
        }));
        return;
      }

      cancelInitRef.current = null;

      if (!initResult.success) {
        // On error also clear both flags — prevents an auto-fail loop on next mount.
        localStorage.removeItem(AUTO_LOAD_KEY);
        localStorage.removeItem(LAST_MODEL_KEY);
        setEngineState((prev: LLMEngineState) => ({
          ...prev,
          status: "error",
          autoLoading: false,
          errorMessage:
            initResult.error instanceof Error
              ? initResult.error.message
              : String(initResult.error),
        }));
      } else {
        // Success: store the last-used model ID and the auto-load flag
        localStorage.setItem(AUTO_LOAD_KEY, "true");
        localStorage.setItem(LAST_MODEL_KEY, targetModelId);
        setEngineState((prev: LLMEngineState) => ({
          ...prev,
          status: "ready",
          progress: 1,
          autoLoading: false,
          loadedModelId: adapter.getLoadedModel()?.modelId ?? null,
        }));
      }
      isInitializingRef.current = false;
    },
    [engineState.status],
  );

  const sendMessage = useCallback(async (content: string) => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    if (isStreamingRef.current) return;
    isStreamingRef.current = true;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    setMessages((prev: ChatMessage[]) => [...prev, userMsg]);
    setIsStreaming(true);

    const assistantMsgId = `assistant-${Date.now()}`;
    setMessages((prev: ChatMessage[]) => [
      ...prev,
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      },
    ]);

    abortControllerRef.current = new AbortController();

    try {
      // Build grounded system prompt.
      let systemPrompt: string;
      try {
        if (!governancePayload) {
          throw new Error("Governance context not loaded");
        }

        const { content: editorChunk, lineEnd } = chunkEditorBuffer(
          editorStateRef.current.content,
          5120,
        );

        const editorContext = {
          ...editorStateRef.current,
          content: editorChunk,
          lineEnd,
        };

        systemPrompt = buildGroundedSystemPrompt({
          governance: governancePayload,
          editor: editorContext,
        });

        const totalTokens =
          estimateTokens(systemPrompt) + estimateTokens(content) + 200;
        const maxTokens = adapter.getLoadedModel()?.contextLength || 32768;

        if (totalTokens > maxTokens * 0.9) {
          throw new Error(
            `System prompt + message (${totalTokens} tokens) exceeds safe limit`,
          );
        }
      } catch (promptError) {
        // eslint-disable-next-line no-console
        console.warn("Failed to build grounded prompt:", promptError);
        systemPrompt =
          "You are HexaGen Monaco AI. Assist with the architecture project.";
      }

      // Apply history pruning.
      const pruned = prunedHistoryWindow(
        messagesRef.current,
        systemPrompt,
        content,
        adapter.getLoadedModel()?.contextLength || 32768,
      );

      const historyMessages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
        ...pruned,
        { role: "user" as const, content },
      ];

      const loadedModel = adapter.getLoadedModel();
      const stream = adapter.streamComplete({
        modelId: loadedModel?.modelId ?? DEFAULT_MODEL_ID,
        messages: historyMessages,
        temperature: DEFAULT_TUNING_CONFIG.temperature,
        maxTokens: DEFAULT_TUNING_CONFIG.maxTokens,
        topP: DEFAULT_TUNING_CONFIG.topP,
        topK: DEFAULT_TUNING_CONFIG.topK,
        frequencyPenalty: DEFAULT_TUNING_CONFIG.frequencyPenalty,
        presencePenalty: DEFAULT_TUNING_CONFIG.presencePenalty,
        repetitionPenalty: DEFAULT_TUNING_CONFIG.repetitionPenalty,
        stream: true,
      });

      for await (const result of stream) {
        if (abortControllerRef.current?.signal.aborted) break;
        if (result.success) {
          setMessages((prev: ChatMessage[]) => {
            const last = prev[prev.length - 1];
            if (!last || last.id !== assistantMsgId) return prev;
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + result.value },
            ];
          });
        } else {
          setMessages((prev: ChatMessage[]) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.id === assistantMsgId) {
              last.content = `Error: ${result.error instanceof Error ? result.error.message : String(result.error)}`;
            }
            return updated;
          });
        }
      }
    } catch (error: unknown) {
      setMessages((prev: ChatMessage[]) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.id === assistantMsgId) {
          last.content =
            error instanceof Error ? error.message : "An error occurred";
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
      isStreamingRef.current = false;
      abortControllerRef.current = null;
    }
  }, []);

  const sendGovernanceMessage = useCallback(
    async (content: string, systemPrompt: string) => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      if (isStreamingRef.current) return;
      isStreamingRef.current = true;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
        timestamp: Date.now(),
      };
      setMessages((prev: ChatMessage[]) => [...prev, userMsg]);
      setIsStreaming(true);

      const assistantMsgId = `assistant-${Date.now()}`;
      setMessages((prev: ChatMessage[]) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        },
      ]);

      abortControllerRef.current = new AbortController();

      try {
        const historyMessages: LLMMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user" as const, content },
        ];

        const loadedModel = adapter.getLoadedModel();
        const stream = adapter.streamComplete({
          modelId: loadedModel?.modelId ?? DEFAULT_MODEL_ID,
          messages: historyMessages,
          temperature: DEFAULT_TUNING_CONFIG.temperature,
          maxTokens: DEFAULT_TUNING_CONFIG.maxTokens,
          topP: DEFAULT_TUNING_CONFIG.topP,
          topK: DEFAULT_TUNING_CONFIG.topK,
          frequencyPenalty: DEFAULT_TUNING_CONFIG.frequencyPenalty,
          presencePenalty: DEFAULT_TUNING_CONFIG.presencePenalty,
          repetitionPenalty: DEFAULT_TUNING_CONFIG.repetitionPenalty,
          stream: true,
        });

        for await (const result of stream) {
          if (abortControllerRef.current?.signal.aborted) break;
          if (result.success) {
            setMessages((prev: ChatMessage[]) => {
              const last = prev[prev.length - 1];
              if (!last || last.id !== assistantMsgId) return prev;
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + result.value },
              ];
            });
          } else {
            setMessages((prev: ChatMessage[]) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.id === assistantMsgId) {
                last.content = `Error: ${result.error instanceof Error ? result.error.message : String(result.error)}`;
              }
              return updated;
            });
          }
        }
      } catch (error: unknown) {
        setMessages((prev: ChatMessage[]) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.id === assistantMsgId) {
            last.content =
              error instanceof Error ? error.message : "An error occurred";
          }
          return updated;
        });
      } finally {
        setIsStreaming(false);
        isStreamingRef.current = false;
        abortControllerRef.current = null;
      }
    },
    [],
  );

  const cancelDownload = useCallback(() => {
    localStorage.removeItem(AUTO_LOAD_KEY);
    localStorage.removeItem(LAST_MODEL_KEY);
    if (cancelInitRef.current) {
      cancelInitRef.current();
      cancelInitRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => {
    setEngineState((prev: LLMEngineState) => ({ ...prev, errorMessage: null }));
  }, []);

  const switchModel = useCallback(
    async (modelId: DomainModelId) => {
      if (modelId === engineState.loadedModelId) return;

      const adapter = adapterRef.current;

      if (isInitializingRef.current) {
        cancelInitRef.current?.();
        cancelInitRef.current = null;
        isInitializingRef.current = false;
        adapter?.dispose();
      } else {
        adapter?.dispose();
      }

      localStorage.removeItem(AUTO_LOAD_KEY);
      localStorage.removeItem(LAST_MODEL_KEY);
      setMessages([]);
      setLoadedModel(null);
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: "opt_in",
        loadedModelId: null,
        errorMessage: null,
        autoLoading: false,
      }));

      await initializeModel(modelId);
    },
    [engineState.loadedModelId, initializeModel],
  );

  const deleteCachedModel = useCallback(
    async (modelId: DomainModelId) => {
      const adapter = adapterRef.current;
      if (!adapter) return;

      if (modelId === engineState.loadedModelId) {
        adapter.dispose();
        setMessages([]);
        setLoadedModel(null);
        localStorage.removeItem(AUTO_LOAD_KEY);
        localStorage.removeItem(LAST_MODEL_KEY);
        setEngineState((prev: LLMEngineState) => ({
          ...prev,
          status: "opt_in",
          loadedModelId: null,
          errorMessage: null,
          autoLoading: false,
        }));
      }

      const result = await adapter.deleteCachedModel(modelId);
      if (!result.success) {
        throw result.error;
      }
    },
    [engineState.loadedModelId],
  );

  const hasModelInCache = useCallback(
    async (modelId: DomainModelId): Promise<boolean> => {
      const adapter = adapterRef.current;
      if (!adapter) return false;

      try {
        return await adapter.hasModelInCache(modelId);
      } catch {
        // Non-fatal — assume not cached if query fails
        return false;
      }
    },
    [],
  );

  // Effect 1: Wire adapters and run WebGPU detection on mount.
  useEffect(() => {
    setMounted(true);
    adapterRef.current = getLocalLLMProvider();
    webgpuRef.current = getWebGPUDetector();

    if (adapterRef.current && webgpuRef.current) {
      webgpuRef.current
        .detect()
        .then((result: Result<{ supported: boolean }>) => {
          const webgpuSupported =
            result.success && (result.value?.supported ?? false);
          const browserSupported = typeof OffscreenCanvas !== "undefined";
          const status = deriveStatus(null, webgpuSupported, browserSupported);
          setEngineState((prev: LLMEngineState) => ({ ...prev, status }));
        })
        .catch(() => {
          setEngineState((prev: LLMEngineState) => ({
            ...prev,
            status: "unsupported_browser",
          }));
        });
    } else {
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: "unavailable",
      }));
    }

    return () => {
      abortControllerRef.current?.abort();
      adapterRef.current?.dispose();
    };
  }, []);

  // Effect 2: Auto-init when WebGPU detection resolves to opt_in and the
  // localStorage flag signals a previously loaded model in IndexedDB cache.
  // Runs reactively so it fires after Effect 1 sets status to "opt_in".
  useEffect(() => {
    if (hasAttemptedAutoInitRef.current) return;
    if (engineState.status !== "opt_in") return;
    if (localStorage.getItem(AUTO_LOAD_KEY) !== "true") return;

    hasAttemptedAutoInitRef.current = true;

    // Attempt to restore the last-used model, fall back to DEFAULT_MODEL_ID
    const lastModelStr = localStorage.getItem(LAST_MODEL_KEY);
    const lastModelParsed = lastModelStr
      ? parseDomainModelId(lastModelStr)
      : null;
    const modelToLoad = lastModelParsed?.success
      ? lastModelParsed.value
      : DEFAULT_MODEL_ID;

    setEngineState((prev: LLMEngineState) => ({ ...prev, autoLoading: true }));
    initializeModel(modelToLoad);
  }, [engineState.status, initializeModel]);

  // Effect 3: Fetch governance context on mount (independent of model state).
  // This ensures governance is available when the user sends the first message.
  useEffect(() => {
    if (governancePayload) return;

    const fetchGovernance = async () => {
      try {
        const res = await fetch("/api/llm/context");
        if (res.ok) {
          const payload = await res.json();
          setGovernancePayload(payload);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Failed to fetch governance context:", err);
      }
    };

    fetchGovernance();
  }, []);

  if (!mounted) {
    return (
      <div className="contents" suppressHydrationWarning>
        {children}
      </div>
    );
  }

  return (
    <LocalLLMContext.Provider
      value={{
        engineState,
        messages,
        isStreaming,
        loadedModel,
        initializeModel,
        cancelDownload,
        sendMessage,
        sendGovernanceMessage,
        clearError,
        switchModel,
        deleteCachedModel,
        hasModelInCache,
      }}
    >
      {children}
    </LocalLLMContext.Provider>
  );
}

const DEFAULT_LLM_VALUE: LocalLLMContextValue = {
  engineState: LLM_ENGINE_INITIAL_STATE,
  messages: [],
  isStreaming: false,
  loadedModel: null,
  initializeModel: async () => {},
  cancelDownload: () => {},
  sendMessage: async () => {},
  sendGovernanceMessage: async () => {},
  clearError: () => {},
  switchModel: async () => {},
  deleteCachedModel: async () => {},
  hasModelInCache: async () => false,
};

export function useLocalLLM(): LocalLLMContextValue {
  const context = useContext(LocalLLMContext);
  if (!context) {
    return DEFAULT_LLM_VALUE;
  }
  return context;
}
