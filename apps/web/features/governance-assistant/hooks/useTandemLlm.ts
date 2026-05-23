"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TandemOrchestratorUseCase,
  PreFlightValidatorUseCase,
  Stage1LocalSpeculationUseCase,
  Stage2PayloadConstructorUseCase,
  Stage3CloudDispatchUseCase,
  LocalStorageTandemConfigAdapter,
  TANDEM_EVENT_TYPES,
} from "@hexagen/tandem-execution";
import type {
  TandemOrchestratorParams,
  TandemTokenMetadata,
} from "@hexagen/tandem-execution";
import type { DomainEvent } from "@hexagen/messaging";
import {
  getSendStructuredRequest,
  getEventBus,
} from "../../../app/lib/wire.client";

export interface TandemChatMessage {
  id: string;
  role: "user" | "assistant";
  visibleContent: string;
  stage1Draft?: string;
  stage: "stage1" | "transitioning" | "stage3" | "complete" | "error";
  isTandem: true;
  errorLabel?: string;
  tokenMetadata?: TandemTokenMetadata;
  timestamp: number;
}

export type TandemStatus =
  | "idle"
  | "stage1"
  | "transitioning"
  | "stage3"
  | "error";

export interface UseTandemLlmReturn {
  messages: TandemChatMessage[];
  status: TandemStatus;
  sendMessage: (params: {
    content: string;
    conversationId: string;
    localModelState: TandemOrchestratorParams["localModelState"];
    cloudHealthState: TandemOrchestratorParams["cloudHealthState"];
    byokCiphertext?: string;
    byokProvider?: string;
    cloudContextLimit?: number;
  }) => Promise<void>;
  abort: () => void;
  stageAwareAbort: (stage: "stage1" | "stage3" | "full") => void;
  clear: () => void;
  currentStage: "idle" | "stage1" | "transitioning" | "stage3";
  retryCloudRefinement: () => Promise<void>;
  canRetry: boolean;
  lastBypassReason: string | null;
  lastResponseWasPartial: boolean;
  lastErrorType: string | null;
  hasOomEvent: boolean;
  clearBypassReason: () => void;
}

export function useTandemLlm(): UseTandemLlmReturn {
  const [messages, setMessages] = useState<TandemChatMessage[]>([]);
  const [status, setStatus] = useState<TandemStatus>("idle");
  const [currentStage, setCurrentStage] = useState<
    "idle" | "stage1" | "transitioning" | "stage3"
  >("idle");
  const [lastBypassReason, setLastBypassReason] = useState<string | null>(null);
  const [lastResponseWasPartial, setLastResponseWasPartial] = useState(false);
  const [lastErrorType, setLastErrorType] = useState<string | null>(null);
  const [hasOomEvent, setHasOomEvent] = useState(false);

  const isStreamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Cache the last send params for retry context (conversationId, byok, etc.)
  const lastSendParamsRef = useRef<{
    conversationId: string;
    byokCiphertext?: string;
    byokProvider?: string;
    cloudContextLimit?: number;
    cloudHealthState: TandemOrchestratorParams["cloudHealthState"];
    localModelState: TandemOrchestratorParams["localModelState"];
  } | null>(null);

  const orchestratorParts = useMemo(() => {
    const eventBus = getEventBus();
    const sendStructuredRequest = getSendStructuredRequest();
    const configAdapter = new LocalStorageTandemConfigAdapter();
    const configResult = configAdapter.read();
    const config = configResult.success ? configResult.value : undefined;
    if (!config) {
      return null;
    }
    const preFlightValidator = new PreFlightValidatorUseCase();
    const stage1 = new Stage1LocalSpeculationUseCase(
      sendStructuredRequest,
      eventBus,
    );
    const stage2 = new Stage2PayloadConstructorUseCase();
    const stage3 = new Stage3CloudDispatchUseCase(eventBus);
    const orchestrator = new TandemOrchestratorUseCase(
      preFlightValidator,
      stage1,
      stage2,
      stage3,
      eventBus,
      config,
    );
    return { orchestrator, stage2, stage3, config };
  }, []);

  useEffect(() => {
    const eventBus = getEventBus();

    const unsubscribers: Array<() => void> = [];

    const sub = <T>(eventType: string, handler: (payload: T) => void) => {
      const unsub = eventBus.subscribe<T>(eventType, (event: DomainEvent<T>) =>
        handler(event.payload),
      );
      unsubscribers.push(unsub);
    };

    sub(TANDEM_EVENT_TYPES.LOCAL_SPECULATION_STARTED, () => {
      setStatus("stage1");
      setCurrentStage("stage1");
    });

    sub<{ conversationId: string; draft: string }>(
      TANDEM_EVENT_TYPES.LOCAL_SPECULATION_COMPLETED,
      ({ draft }) => {
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
          const last = prev[lastIdx];
          return [
            ...prev.slice(0, lastIdx),
            {
              ...last,
              stage1Draft: draft,
              stage: "transitioning" as const,
            },
          ];
        });
        setStatus("transitioning");
        setCurrentStage("transitioning");
      },
    );

    sub<{ conversationId: string; error: string }>(
      TANDEM_EVENT_TYPES.LOCAL_SPECULATION_FAILED,
      ({ error }) => {
        // OOM detection — treat errors containing "memory" as OOM events
        if (error.toLowerCase().includes("memory")) {
          setHasOomEvent(true);
        }
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
          const last = prev[lastIdx];
          return [
            ...prev.slice(0, lastIdx),
            {
              ...last,
              stage: "error" as const,
              errorLabel: error,
            },
          ];
        });
        setStatus("error");
        setCurrentStage("idle");
      },
    );

    sub(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_STARTED, () => {
      setMessages((prev) => {
        const lastIdx = prev.length - 1;
        if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
        const last = prev[lastIdx];
        return [
          ...prev.slice(0, lastIdx),
          {
            ...last,
            stage: "stage3" as const,
            visibleContent: "",
          },
        ];
      });
      setStatus("stage3");
      setCurrentStage("stage3");
    });

    sub<{ conversationId: string; error: string; partialContent?: string }>(
      TANDEM_EVENT_TYPES.CLOUD_HANDOFF_FAILED,
      ({ error }) => {
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
          const last = prev[lastIdx];
          return [
            ...prev.slice(0, lastIdx),
            {
              ...last,
              stage: "error" as const,
              errorLabel: error,
            },
          ];
        });
        setStatus("error");
        setCurrentStage("idle");
      },
    );

    sub<{
      conversationId: string;
      content: string;
      tokenMetadata?: TandemTokenMetadata;
      partial?: boolean;
    }>(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_COMPLETED, ({ partial }) => {
      if (partial) {
        setLastResponseWasPartial(true);
      }
    });

    sub<{
      conversationId: string;
      finalContent: string;
      stage1Draft?: string;
      tokenMetadata?: TandemTokenMetadata;
    }>(TANDEM_EVENT_TYPES.FINAL_OUTPUT_COMPLETED, ({ tokenMetadata }) => {
      setMessages((prev) => {
        const lastIdx = prev.length - 1;
        if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
        const last = prev[lastIdx];
        return [
          ...prev.slice(0, lastIdx),
          {
            ...last,
            stage: "complete" as const,
            tokenMetadata: tokenMetadata ?? last.tokenMetadata,
          },
        ];
      });
      setStatus("idle");
      setCurrentStage("idle");
    });

    return () => {
      for (const unsub of unsubscribers) unsub();
    };
  }, []);

  const sendMessage = useCallback(
    async (params: {
      content: string;
      conversationId: string;
      localModelState: TandemOrchestratorParams["localModelState"];
      cloudHealthState: TandemOrchestratorParams["cloudHealthState"];
      byokCiphertext?: string;
      byokProvider?: string;
      cloudContextLimit?: number;
    }) => {
      if (isStreamingRef.current) return;
      if (!orchestratorParts) {
        setStatus("error");
        return;
      }

      const { orchestrator } = orchestratorParts;

      // Reset per-run notification state
      setLastBypassReason(null);
      setLastResponseWasPartial(false);
      setLastErrorType(null);

      isStreamingRef.current = true;

      const now = Date.now();
      const assistantId = `tandem-assistant-${now}`;

      // Cache params for potential retry
      lastSendParamsRef.current = {
        conversationId: params.conversationId,
        byokCiphertext: params.byokCiphertext,
        byokProvider: params.byokProvider,
        cloudContextLimit: params.cloudContextLimit,
        cloudHealthState: params.cloudHealthState,
        localModelState: params.localModelState,
      };

      const historyForOrchestrator = messagesRef.current
        .filter((m) => m.role !== "assistant" || m.stage === "complete")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.visibleContent,
        }));

      setMessages((prev) => [
        ...prev,
        {
          id: `tandem-user-${now}`,
          role: "user",
          visibleContent: params.content,
          stage: "complete" as const,
          isTandem: true,
          timestamp: now,
        },
        {
          id: assistantId,
          role: "assistant",
          visibleContent: "",
          stage: "stage1" as const,
          isTandem: true,
          timestamp: now,
        },
      ]);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const result = await orchestrator.executePipeline({
          prompt: params.content,
          conversationId: params.conversationId,
          history: historyForOrchestrator,
          isStreamingRef,
          localModelState: params.localModelState,
          cloudHealthState: params.cloudHealthState,
          byokCiphertext: params.byokCiphertext,
          byokProvider: params.byokProvider,
          cloudContextLimit: params.cloudContextLimit,
          signal: abortController.signal,
          onToken: (chunk: string) => {
            setMessages((prev) => {
              const lastIdx = prev.length - 1;
              if (lastIdx < 0 || prev[lastIdx].role !== "assistant")
                return prev;
              const last = prev[lastIdx];
              return [
                ...prev.slice(0, lastIdx),
                {
                  ...last,
                  visibleContent: last.visibleContent + chunk,
                },
              ];
            });
          },
        } as TandemOrchestratorParams);

        if (!result.success) {
          const errorMsg = result.error.message;
          // Extract errorType from orchestrator error messages like "Stage 3 failed: rate_limited"
          const stage3ErrorMatch = /Stage 3 failed: (\w+)/.exec(errorMsg);
          if (stage3ErrorMatch) {
            setLastErrorType(stage3ErrorMatch[1] ?? null);
          }
          setMessages((prev) => {
            const lastIdx = prev.length - 1;
            if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
            const last = prev[lastIdx];
            return [
              ...prev.slice(0, lastIdx),
              {
                ...last,
                stage: "error" as const,
                errorLabel: errorMsg,
              },
            ];
          });
          setStatus("error");
        } else {
          // Successful result — capture bypass reason for notifications
          const bypassReason = result.value.bypassReason;
          if (bypassReason && bypassReason !== "none") {
            setLastBypassReason(bypassReason);
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatus("idle");
          setCurrentStage("idle");
          return;
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
          const last = prev[lastIdx];
          return [
            ...prev.slice(0, lastIdx),
            {
              ...last,
              stage: "error" as const,
              errorLabel: errorMsg,
            },
          ];
        });
        setStatus("error");
        setCurrentStage("idle");
      } finally {
        isStreamingRef.current = false;
        abortControllerRef.current = null;
      }
    },
    [orchestratorParts],
  );

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isStreamingRef.current = false;
    setStatus("idle");
    setCurrentStage("idle");
  }, []);

  /**
   * Stage-aware abort:
   * - "stage1": cancel Stage 1, mark message as "Draft cancelled", re-enable input.
   *   Stage 3 will NOT run because the abort signal is shared with the orchestrator.
   * - "stage3": cancel Stage 3. Retain any visibleContent already streamed.
   *   If no visibleContent yet, fall back to showing stage1Draft with a label.
   * - "full": abort everything, mark as error (same as abort()).
   */
  const stageAwareAbort = useCallback((stage: "stage1" | "stage3" | "full") => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isStreamingRef.current = false;

    if (stage === "full") {
      setMessages((prev) => {
        const lastIdx = prev.length - 1;
        if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
        const last = prev[lastIdx];
        return [
          ...prev.slice(0, lastIdx),
          {
            ...last,
            stage: "error" as const,
            errorLabel: "Tandem request cancelled.",
          },
        ];
      });
      setStatus("error");
      setCurrentStage("idle");
      return;
    }

    if (stage === "stage1") {
      setMessages((prev) => {
        const lastIdx = prev.length - 1;
        if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
        const last = prev[lastIdx];
        return [
          ...prev.slice(0, lastIdx),
          {
            ...last,
            stage: "complete" as const,
            errorLabel: "Draft cancelled",
          },
        ];
      });
      setStatus("idle");
      setCurrentStage("idle");
      return;
    }

    // stage === "stage3"
    setMessages((prev) => {
      const lastIdx = prev.length - 1;
      if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
      const last = prev[lastIdx];

      if (last.visibleContent.trim().length > 0) {
        // Stage 3 already yielded content — keep it as the final answer
        return [
          ...prev.slice(0, lastIdx),
          {
            ...last,
            stage: "complete" as const,
          },
        ];
      }

      // Stage 3 had not yielded content yet — fall back to stage1Draft
      const fallbackContent = last.stage1Draft ?? "";
      return [
        ...prev.slice(0, lastIdx),
        {
          ...last,
          visibleContent: fallbackContent,
          stage: "complete" as const,
          errorLabel: "Cloud refinement cancelled — showing local draft",
        },
      ];
    });
    setStatus("idle");
    setCurrentStage("idle");
  }, []);

  /**
   * Retry Stage 3 only — reconstructs the Stage 2 payload from the cached
   * stage1Draft in the last assistant message, then dispatches Stage 3 directly.
   * Never re-runs Stage 1.
   */
  const retryCloudRefinement = useCallback(async () => {
    if (isStreamingRef.current) return;
    if (!orchestratorParts) return;

    const { stage2, stage3, config } = orchestratorParts;
    const savedParams = lastSendParamsRef.current;
    if (!savedParams) return;

    const currentMessages = messagesRef.current;
    const lastMsg = currentMessages[currentMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;
    const draft = lastMsg.stage1Draft;
    if (!draft) return;

    // Find the last user message to reconstruct the prompt
    let prompt = "";
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      if (currentMessages[i].role === "user") {
        prompt = currentMessages[i].visibleContent;
        break;
      }
    }
    if (!prompt) return;

    isStreamingRef.current = true;
    setStatus("stage3");
    setCurrentStage("stage3");

    // Reset the last assistant message to a fresh stage3 state
    setMessages((prev) => {
      const lastIdx = prev.length - 1;
      if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
      const last = prev[lastIdx];
      return [
        ...prev.slice(0, lastIdx),
        {
          ...last,
          visibleContent: "",
          stage: "stage3" as const,
          errorLabel: undefined,
        },
      ];
    });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Rebuild Stage 2 payload
    const historyForStage2 = currentMessages
      .filter((m) => m.role !== "assistant" || m.stage === "complete")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.visibleContent,
      }));

    const stage2Result = stage2.constructPayload({
      userPrompt: prompt,
      localDraft: draft,
      history: historyForStage2,
      cloudContextLimit: savedParams.cloudContextLimit ?? 4096,
    });

    if (!stage2Result.success) {
      setMessages((prev) => {
        const lastIdx = prev.length - 1;
        if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
        const last = prev[lastIdx];
        return [
          ...prev.slice(0, lastIdx),
          {
            ...last,
            stage: "error" as const,
            errorLabel: "Failed to rebuild Stage 2 payload for retry.",
          },
        ];
      });
      setStatus("error");
      setCurrentStage("idle");
      isStreamingRef.current = false;
      abortControllerRef.current = null;
      return;
    }

    const payload = stage2Result.value.payload;

    try {
      const stage3Result = await stage3.execute({
        payload,
        conversationId: savedParams.conversationId,
        refinementEngine: config.refinementEngine,
        byokCiphertext: savedParams.byokCiphertext,
        byokProvider: savedParams.byokProvider,
        autoRetryEnabled: config.autoRetryEnabled,
        signal: abortController.signal,
        onToken: (chunk: string) => {
          setMessages((prev) => {
            const lastIdx = prev.length - 1;
            if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
            const last = prev[lastIdx];
            return [
              ...prev.slice(0, lastIdx),
              {
                ...last,
                visibleContent: last.visibleContent + chunk,
              },
            ];
          });
        },
      });

      if (
        stage3Result.errorType &&
        stage3Result.errorType !== "partial_stream" &&
        stage3Result.errorType !== "cancelled"
      ) {
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
          const last = prev[lastIdx];
          return [
            ...prev.slice(0, lastIdx),
            {
              ...last,
              stage: "error" as const,
              errorLabel: `Cloud retry failed: ${stage3Result.errorType ?? "unknown"}`,
            },
          ];
        });
        setStatus("error");
        setCurrentStage("idle");
      } else if (stage3Result.errorType === "cancelled") {
        // Aborted during retry — handled by stageAwareAbort, just clean up state
        setStatus("idle");
        setCurrentStage("idle");
      } else {
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
          const last = prev[lastIdx];
          return [
            ...prev.slice(0, lastIdx),
            {
              ...last,
              stage: "complete" as const,
            },
          ];
        });
        setStatus("idle");
        setCurrentStage("idle");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("idle");
        setCurrentStage("idle");
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0 || prev[lastIdx].role !== "assistant") return prev;
          const last = prev[lastIdx];
          return [
            ...prev.slice(0, lastIdx),
            {
              ...last,
              stage: "error" as const,
              errorLabel: errorMsg,
            },
          ];
        });
        setStatus("error");
        setCurrentStage("idle");
      }
    } finally {
      isStreamingRef.current = false;
      abortControllerRef.current = null;
    }
  }, [orchestratorParts]);

  /**
   * canRetry is true when the last assistant message has a stage1Draft and
   * either: the status is "error", or the errorLabel contains "cancelled".
   */
  const canRetry = useMemo(() => {
    if (status !== "idle" && status !== "error") return false;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return false;
    if (!lastMsg.stage1Draft) return false;
    if (
      lastMsg.stage === "error" ||
      lastMsg.errorLabel?.toLowerCase().includes("cancelled")
    ) {
      return true;
    }
    return false;
  }, [messages, status]);

  const clear = useCallback(() => {
    setMessages([]);
    setStatus("idle");
    setCurrentStage("idle");
    setLastBypassReason(null);
    setLastResponseWasPartial(false);
    setLastErrorType(null);
    setHasOomEvent(false);
    lastSendParamsRef.current = null;
  }, []);

  const clearBypassReason = useCallback(() => {
    setLastBypassReason(null);
  }, []);

  return {
    messages,
    status,
    sendMessage,
    abort,
    stageAwareAbort,
    clear,
    currentStage,
    retryCloudRefinement,
    canRetry,
    lastBypassReason,
    lastResponseWasPartial,
    lastErrorType,
    hasOomEvent,
    clearBypassReason,
  };
}
