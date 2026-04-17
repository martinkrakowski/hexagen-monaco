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
} from "@hexagen/local-llm";
import { DEFAULT_MODEL_ID } from "@hexagen/local-llm";
import type { WebGPUDetectorPort } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";
import type { LLMEngineState, LLMEngineStatus } from "@hexagen/local-llm";
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

/** localStorage key persisted after a successful model load. */
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
  initializeModel: () => Promise<void>;
  cancelDownload: () => void;
  sendMessage: (content: string) => Promise<void>;
  clearError: () => void;
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

  const [engineState, setEngineState] = useState<LLMEngineState>(
    LLM_ENGINE_INITIAL_STATE,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [governancePayload, setGovernancePayload] =
    useState<GovernancePayload | null>(null);

  const { editorState } = useEditor();
  const editorStateRef = useRef<EditorContextState>(editorState);

  useEffect(() => {
    editorStateRef.current = editorState;
  }, [editorState]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const initializeModel = useCallback(async () => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    if (isInitializingRef.current) return;
    if (engineState.status === "ready") return;

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
          { modelId: DEFAULT_MODEL_ID },
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
      // Cancelled — terminate the worker, reset to opt_in, clear the auto-load
      // flag so a refresh doesn't re-trigger the failed/cancelled auto-init.
      localStorage.removeItem(AUTO_LOAD_KEY);
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
      // On error also clear the flag — prevents an auto-fail loop on next mount.
      localStorage.removeItem(AUTO_LOAD_KEY);
      const webgpuSupported = webgpuRef.current?.isSupported() ?? false;
      const browserSupported = typeof OffscreenCanvas !== "undefined";
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: deriveStatus(null, webgpuSupported, browserSupported),
        autoLoading: false,
        errorMessage:
          initResult.error instanceof Error
            ? initResult.error.message
            : String(initResult.error),
      }));
    } else {
      localStorage.setItem(AUTO_LOAD_KEY, "true");
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: "ready",
        progress: 1,
        autoLoading: false,
        loadedModelId: adapter.getLoadedModel()?.modelId ?? null,
      }));
    }
    isInitializingRef.current = false;
  }, [engineState.status]);

  const sendMessage = useCallback(async (content: string) => {
    const adapter = adapterRef.current;
    if (!adapter) return;

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
        const maxTokens = adapter.getLoadedModel()?.contextLength || 4096;

        if (totalTokens > maxTokens * 0.9) {
          throw new Error(
            `System prompt + message (${totalTokens} tokens) exceeds safe limit`,
          );
        }
      } catch (promptError) {
        console.warn("Failed to build grounded prompt:", promptError);
        systemPrompt =
          "You are HexaGen Monaco AI. Assist with the architecture project.";
      }

      // Apply history pruning.
      const pruned = prunedHistoryWindow(
        messagesRef.current,
        systemPrompt,
        content,
        adapter.getLoadedModel()?.contextLength || 4096,
      );

      const historyMessages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
        ...pruned,
        { role: "user" as const, content },
      ];

      const stream = adapter.streamComplete({
        model: adapter.getLoadedModel()?.modelId ?? DEFAULT_MODEL_ID,
        messages: historyMessages,
        temperature: 0.7,
        maxTokens: 2048,
        stream: true,
      });

      for await (const result of stream) {
        if (abortControllerRef.current?.signal.aborted) break;
        if (result.success) {
          setMessages((prev: ChatMessage[]) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.id === assistantMsgId) {
              last.content += result.value;
            }
            return updated;
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
      abortControllerRef.current = null;
    }
  }, []);

  const cancelDownload = useCallback(() => {
    localStorage.removeItem(AUTO_LOAD_KEY);
    if (cancelInitRef.current) {
      cancelInitRef.current();
      cancelInitRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => {
    setEngineState((prev: LLMEngineState) => ({ ...prev, errorMessage: null }));
  }, []);

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
    setEngineState((prev: LLMEngineState) => ({ ...prev, autoLoading: true }));
    initializeModel();
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
        initializeModel,
        cancelDownload,
        sendMessage,
        clearError,
      }}
    >
      {children}
    </LocalLLMContext.Provider>
  );
}

export function useLocalLLM(): LocalLLMContextValue {
  const context = useContext(LocalLLMContext);
  if (!context) {
    throw new Error("useLocalLLM must be used within a LocalLLMProvider");
  }
  return context;
}
