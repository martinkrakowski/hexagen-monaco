"use client";

import { useCallback, useRef, useState } from "react";

export interface ModificationStreamingState {
  isStreaming: boolean;
  error: string | null;
}

const STREAM_ENDPOINT = "/api/architecture/modify/stream";
const DEBOUNCE_MS = 1000;

interface UseModificationStreamingOptions {
  onPipelineComplete?: (data: {
    patches: unknown[];
    transactionId: string;
  }) => void;
  onPipelineError?: (error: string) => void;
}

export function useModificationStreaming(
  options: UseModificationStreamingOptions = {},
) {
  const { onPipelineComplete, onPipelineError } = options;

  const [streamingState, setStreamingState] =
    useState<ModificationStreamingState>({
      isStreaming: false,
      error: null,
    });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStreaming = useCallback(
    (intent: string) => {
      if (!intent.trim()) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        abortControllerRef.current?.abort();
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        setStreamingState({ isStreaming: true, error: null });

        try {
          const response = await fetch(STREAM_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intent }),
            signal: abortController.signal,
          });

          if (!response.ok) {
            let errorMsg = `HTTP ${response.status}`;
            try {
              const errorBody = await response.json();
              errorMsg = (errorBody as { error?: string }).error ?? errorMsg;
            } catch {
              // Ignore JSON parse errors on error responses.
            }
            setStreamingState({ isStreaming: false, error: errorMsg });
            onPipelineError?.(errorMsg);
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            const errorMsg = "No response body";
            setStreamingState({ isStreaming: false, error: errorMsg });
            onPipelineError?.(errorMsg);
            return;
          }

          const decoder = new TextDecoder();
          let buffer = "";
          let streamDone = false;

          while (!streamDone) {
            const { done, value } = await reader.read();
            if (done) {
              streamDone = true;
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            let currentEvent = "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("event: ")) {
                currentEvent = trimmed.slice(7);
              } else if (trimmed.startsWith("data: ") && currentEvent) {
                const data = trimmed.slice(6);
                let parsed: Record<string, unknown>;
                try {
                  parsed = JSON.parse(data) as Record<string, unknown>;
                } catch {
                  continue;
                }

                if (currentEvent === "pipeline_complete") {
                  onPipelineComplete?.({
                    patches: (parsed.patches ?? []) as unknown[],
                    transactionId: (parsed.transactionId as string) ?? "",
                  });
                  setStreamingState({ isStreaming: false, error: null });
                } else if (currentEvent === "pipeline_error") {
                  const errorMsg = (parsed.error as string) ?? "Pipeline error";
                  setStreamingState({ isStreaming: false, error: errorMsg });
                  onPipelineError?.(errorMsg);
                }

                currentEvent = "";
              }
            }
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          setStreamingState({ isStreaming: false, error: errorMsg });
          onPipelineError?.(errorMsg);
        } finally {
          abortControllerRef.current = null;
        }
      }, DEBOUNCE_MS);
    },
    [onPipelineComplete, onPipelineError],
  );

  const abort = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreamingState({ isStreaming: false, error: null });
  }, []);

  return { streamingState, startStreaming, abort };
}
