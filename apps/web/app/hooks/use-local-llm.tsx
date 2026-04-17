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
      return "opt_in";
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

  const [engineState, setEngineState] = useState<LLMEngineState>(
    LLM_ENGINE_INITIAL_STATE,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mounted, setMounted] = useState(false);

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
            const webgpuSupported = webgpuRef.current?.isSupported() ?? false;
            const browserSupported = typeof OffscreenCanvas !== "undefined";
            setEngineState((prev: LLMEngineState) => ({
              ...prev,
              status: deriveStatus(progress, webgpuSupported, browserSupported),
              progress: progress.progress,
            }));
          },
        ),
        cancelPromise,
      ]);
    } catch {
      // cancelled — terminate the worker, reset to opt_in
      adapter.dispose();
      cancelInitRef.current = null;
      isInitializingRef.current = false;
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: "opt_in",
        progress: 0,
        errorMessage: null,
      }));
      return;
    }

    cancelInitRef.current = null;

    if (!initResult.success) {
      const webgpuSupported = webgpuRef.current?.isSupported() ?? false;
      const browserSupported = typeof OffscreenCanvas !== "undefined";
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: deriveStatus(null, webgpuSupported, browserSupported),
        errorMessage:
          initResult.error instanceof Error
            ? initResult.error.message
            : String(initResult.error),
      }));
    } else {
      setEngineState((prev: LLMEngineState) => ({
        ...prev,
        status: "ready",
        progress: 1,
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
      const currentMessages = messagesRef.current;
      const historyMessages: LLMMessage[] = [
        ...currentMessages.map((m: ChatMessage) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
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
    if (cancelInitRef.current) {
      cancelInitRef.current();
      cancelInitRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => {
    setEngineState((prev: LLMEngineState) => ({ ...prev, errorMessage: null }));
  }, []);

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
