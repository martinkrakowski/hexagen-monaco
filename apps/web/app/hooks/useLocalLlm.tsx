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
  ChatMessage,
} from "@hexagen/local-llm";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_TUNING_CONFIG,
  parseDomainModelId,
  LEGACY_MODEL_MIGRATION,
} from "@hexagen/local-llm";
import type { WebGPUDetectorPort } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";
import type {
  LLMEngineState,
  LLMEngineStatus,
  ModelMetadata,
} from "@hexagen/local-llm";
import { LLM_ENGINE_INITIAL_STATE } from "@hexagen/local-llm";

// Re-export for backward compatibility with existing components
export type { ChatMessage };
import {
  getLocalLLMProvider,
  getWebGPUDetector,
  getChatPersistence,
} from "@/lib/wire";

import {
  buildGroundedSystemPrompt,
  chunkEditorBuffer,
  estimateTokens,
  prunedHistoryWindow,
  type GovernancePayload,
  type EditorState as EditorContextState,
} from "@/lib/grounded-prompt";
import { useCodeChangeSubscription } from "@/hooks/useSharedState";
import { LOCAL_MODELS } from "@/config/models";

/**
 * Initial editor snapshot used before any code-change event fires.
 * filename/language defaults reflect the primary artifact (manifest.yaml);
 * actual lineEnd is recomputed by chunkEditorBuffer at send time.
 */
const INITIAL_EDITOR_STATE: EditorContextState = {
  filename: "manifest.yaml",
  language: "yaml",
  content: "",
  lineStart: 1,
  lineEnd: 1,
};

/**
 * localStorage key for remembering the last-used model ID.
 * Stores a DomainModelId enum value (e.g., "qwen-2.5-3b")
 */
const LAST_MODEL_KEY = "hexagen:local-llm:last-model";

/** localStorage key for the auto-load flag. */
export const AUTO_LOAD_KEY = "hexagen:local-llm:auto-load";

/** localStorage key - set to "true" after user successfully enables Local AI for the first time. Persists indefinitely. */
export const HAS_ENABLED_KEY = "hexagen:local-llm:has-enabled";

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
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [governancePayload, setGovernancePayload] =
    useState<GovernancePayload | null>(null);

  const loadedModel =
    engineState.status === "ready" || engineState.status === "loading_vram"
      ? (adapterRef.current?.getLoadedModel() ?? null)
      : null;

  // Mirror the latest editor buffer via CodeChangeEvent subscription —
  // Monaco emits on every save. Stored in a ref so no re-render fires
  // when content changes; readers access via editorStateRef.current
  // at send time (see sendGovernanceMessage below).
  const editorStateRef = useRef<EditorContextState>(INITIAL_EDITOR_STATE);
  useCodeChangeSubscription((event) => {
    editorStateRef.current = {
      ...editorStateRef.current,
      content: event.content,
    };
  });

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
        // Cancelled — terminate the worker.
        // Always clear AUTO_LOAD_KEY and LAST_MODEL_KEY so a subsequent page
        // reload does not attempt a silent background download. HAS_ENABLED_KEY
        // is preserved if set, keeping the user in "requires_model" routing
        // rather than dropping them back to the first-time OptIn screen.
        const hasPreviouslyEnabled =
          localStorage.getItem(HAS_ENABLED_KEY) !== null;
        localStorage.removeItem(AUTO_LOAD_KEY);
        localStorage.removeItem(LAST_MODEL_KEY);
        adapter.dispose();
        cancelInitRef.current = null;
        isInitializingRef.current = false;
        setEngineState((prev: LLMEngineState) => ({
          ...prev,
          status: hasPreviouslyEnabled ? "requires_model" : "opt_in",
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
        // Success: store the last-used model ID, auto-load flag, and has-enabled flag
        localStorage.setItem(AUTO_LOAD_KEY, "true");
        localStorage.setItem(LAST_MODEL_KEY, targetModelId);
        // Only set HAS_ENABLED_KEY on first successful enable, never clear it on cancel/switch
        if (localStorage.getItem(HAS_ENABLED_KEY) !== "true") {
          localStorage.setItem(HAS_ENABLED_KEY, "true");
        }
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
    async (content: string, systemPrompt: string, history?: LLMMessage[]) => {
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
        const historyMessages: LLMMessage[] = history
          ? [
              { role: "system", content: systemPrompt },
              ...history,
              { role: "user" as const, content },
            ]
          : [
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
    // Always clear both the auto-load flag and the last-model key on a manual
    // cancel. HAS_ENABLED_KEY is sufficient to remember that the user has
    // previously opted in — leaving AUTO_LOAD_KEY alive without a verified
    // cached model would trigger a silent background download on the next page
    // load, trapping the user behind a global spinner.
    localStorage.removeItem(AUTO_LOAD_KEY);
    localStorage.removeItem(LAST_MODEL_KEY);
    if (cancelInitRef.current) {
      cancelInitRef.current();
      cancelInitRef.current = null;
    }
  }, []);

  const enterRequiresModel = useCallback(() => {
    // AIArchitectPanel detected cached models but no selected model — enter requires_model state
    setEngineState((prev: LLMEngineState) => ({
      ...prev,
      status: "requires_model",
    }));
  }, []);

  const clearError = useCallback(() => {
    setEngineState((prev: LLMEngineState) => ({ ...prev, errorMessage: null }));
  }, []);

  const returnToModelSettings = useCallback(() => {
    const hasPreviouslyEnabled = localStorage.getItem(HAS_ENABLED_KEY) !== null;
    if (isInitializingRef.current || cancelInitRef.current) {
      cancelDownload();
      return;
    }
    setEngineState((prev) => ({
      ...prev,
      status: hasPreviouslyEnabled ? "requires_model" : "opt_in",
      errorMessage: null,
      progress: 0,
      autoLoading: false,
    }));
  }, [cancelDownload]);

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
        localStorage.removeItem(AUTO_LOAD_KEY);
        localStorage.removeItem(LAST_MODEL_KEY);
        setEngineState((prev: LLMEngineState) => ({
          ...prev,
          status: "requires_model",
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

  const hasAnyCachedModel = useCallback(async (): Promise<boolean> => {
    const adapter = adapterRef.current;
    if (!adapter) return false;

    try {
      const results = await Promise.all(
        LOCAL_MODELS.map(async (model) => {
          try {
            return await adapter.hasModelInCache(model.modelId);
          } catch {
            return false;
          }
        }),
      );
      return results.some((isCached) => isCached);
    } catch {
      return false;
    }
  }, []);

  // Effect 1: Wire adapters and run WebGPU detection on mount.
  useEffect(() => {
    setMounted(true);

    // Migration: users from before HAS_ENABLED_KEY was introduced only have AUTO_LOAD_KEY.
    // Backfill HAS_ENABLED_KEY so the opted-in hold logic works for existing users.
    if (
      localStorage.getItem(AUTO_LOAD_KEY) === "true" &&
      localStorage.getItem(HAS_ENABLED_KEY) === null
    ) {
      localStorage.setItem(HAS_ENABLED_KEY, "true");
    }

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

  // Effect 1b: Load chat history from IndexedDB on mount (independent of model state).
  useEffect(() => {
    if (isHistoryLoaded) return; // Already loaded

    const port = getChatPersistence();
    port
      .loadChatHistory()
      .then((result: Result<ChatMessage[]>) => {
        if (result.success && result.value.length > 0) {
          setMessages(result.value);
        }
        setIsHistoryLoaded(true);
      })
      .catch(() => {
        // Non-fatal — allow app to proceed even if load fails
        setIsHistoryLoaded(true);
      });
  }, [isHistoryLoaded]);

  // Effect 2: Auto-init when WebGPU detection resolves to opt_in and the
  // localStorage flag signals a previously loaded model in IndexedDB cache.
  // Runs reactively so it fires after Effect 1 sets status to "opt_in".
  useEffect(() => {
    if (hasAttemptedAutoInitRef.current) return;
    if (engineState.status !== "opt_in") return;

    if (localStorage.getItem(AUTO_LOAD_KEY) === "true") {
      // Attempt to restore the last-used model, fall back to DEFAULT_MODEL_ID
      let lastModelStr = localStorage.getItem(LAST_MODEL_KEY);

      // Handle legacy model IDs that were removed and replaced
      if (lastModelStr && lastModelStr in LEGACY_MODEL_MIGRATION) {
        const migratedId =
          LEGACY_MODEL_MIGRATION[
            lastModelStr as keyof typeof LEGACY_MODEL_MIGRATION
          ];
        lastModelStr = migratedId;
        // Update localStorage with the new model ID
        localStorage.setItem(LAST_MODEL_KEY, migratedId);
      }

      const lastModelParsed = lastModelStr
        ? parseDomainModelId(lastModelStr)
        : null;
      const modelToLoad = lastModelParsed?.success
        ? lastModelParsed.value
        : DEFAULT_MODEL_ID;

      hasAttemptedAutoInitRef.current = true;

      // Only auto-load if the target model is actually in cache.
      // If it is not cached (e.g. the user cancelled mid-download on the previous
      // session), silently downloading a potentially multi-GB model behind a
      // global spinner is unacceptable. Instead, clear the stale AUTO_LOAD_KEY
      // and transition to "requires_model" so the user can choose a model
      // explicitly from the settings view.
      hasModelInCache(modelToLoad).then((isCached) => {
        if (isCached) {
          setEngineState((prev: LLMEngineState) => ({
            ...prev,
            autoLoading: true,
          }));
          initializeModel(modelToLoad);
        } else {
          localStorage.removeItem(AUTO_LOAD_KEY);
          setEngineState((prev: LLMEngineState) => ({
            ...prev,
            status: "requires_model",
            autoLoading: false,
          }));
        }
      });
    } else if (localStorage.getItem(HAS_ENABLED_KEY) !== null) {
      // Previously opted in but no AUTO_LOAD_KEY (e.g. after cancel or cache
      // clear). Transition to "requires_model" so the UI shows the model
      // selection screen instead of a stuck spinner. Without this branch,
      // status remains "opt_in" indefinitely, trapping opted-in users behind
      // the Opted-In Hold spinner.
      hasAttemptedAutoInitRef.current = true;
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: "requires_model",
        autoLoading: false,
      }));
    } else {
      // If neither branch matches, the user is new — route to settings to select a model.
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: "requires_model",
        autoLoading: false,
      }));
      hasAttemptedAutoInitRef.current = true;
    }
  }, [engineState.status, initializeModel, hasModelInCache]);

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

  // Effect 4: Persist chat history when streaming completes and history is loaded.
  // Only saves after initial load to avoid persisting partial states on mount.
  useEffect(() => {
    if (!isHistoryLoaded || isStreaming || messages.length === 0) return;

    const port = getChatPersistence();
    port.saveChatHistory(messages).catch(() => {
      // Non-fatal — allow app to proceed even if save fails
      // eslint-disable-next-line no-console
      console.warn("Failed to save chat history");
    });
  }, [isHistoryLoaded, isStreaming, messages]);

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
        enterRequiresModel,
        sendMessage,
        sendGovernanceMessage,
        clearError,
        switchModel,
        deleteCachedModel,
        hasModelInCache,
        hasAnyCachedModel,
        returnToModelSettings,
      }}
    >
      {children}
    </LocalLLMContext.Provider>
  );
}

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
