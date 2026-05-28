import type { EventBusPort } from "@hexagen/messaging";
import { TANDEM_EVENT_TYPES, createTandemEvent } from "../../domain/index.js";

// ---------------------------------------------------------------------------
// Stage 3 System Prompt (Section 6.3)
// ---------------------------------------------------------------------------

export const STAGE_3_SYSTEM_PROMPT = `You are a refinement engine. You will receive a structured payload containing an original user instruction, optional conversation history, and a first-pass draft produced by a local language model.

Your task:
1. Read the original instruction carefully.
2. Review the local draft critically — it may contain errors, omissions, or rough phrasing.
3. Produce a final, polished response that fully satisfies the original instruction.
4. Do not reference the local draft in your response. Do not say "the previous draft said" or similar. Produce a clean, standalone final answer.
5. If the local draft is substantially incorrect, discard it and answer from scratch.`;

// ---------------------------------------------------------------------------
// Stage 3 types
// ---------------------------------------------------------------------------

export interface Stage3Params {
  payload: string;
  conversationId: string;
  refinementEngine: string; // 'ENV' | 'BYOK' | provider id
  byokCiphertext?: string;
  byokProvider?: string;
  onToken?: (chunk: string) => void;
  signal?: AbortSignal;
  autoRetryEnabled: boolean;
}

export interface Stage3Result {
  content: string;
  partial: boolean;
  errorType?:
    | "rate_limited"
    | "network_failure"
    | "partial_stream"
    | "cancelled";
  retryAfterSeconds?: number;
}

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

/**
 * Parses a Server-Sent Events stream from a Response body.
 * Yields each data chunk (content after "data: " prefix).
 */
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const stripped = line.replace(/\r$/, "");
        if (stripped.startsWith("data: ")) {
          const data = stripped.slice("data: ".length);
          if (data === "[DONE]") return;
          if (data.length > 0) {
            yield data;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Stage3CloudDispatchUseCase
// ---------------------------------------------------------------------------

/**
 * Stage3CloudDispatchUseCase
 *
 * Dispatches the Stage 2 payload to the cloud refinement engine via
 * `/api/llm/chat` (ADR-0030 — never directly to a provider endpoint).
 *
 * Handles:
 * - SSE streaming with token callbacks
 * - 429 rate limiting with optional exponential backoff retry
 * - Network failures
 * - AbortSignal cancellation
 * - BYOK ciphertext rotation via `X-Byok-Rotated-Ciphertext` response header
 *
 * NOTE: Session cache for the Stage 2 payload is owned by
 * TandemOrchestratorUseCase. Stage3 receives the payload as a parameter.
 */
export class Stage3CloudDispatchUseCase {
  constructor(private readonly eventBus: EventBusPort) {}

  async execute(params: Stage3Params): Promise<Stage3Result> {
    return this._executeWithRetry(params, 0);
  }

  private async _executeWithRetry(
    params: Stage3Params,
    attempt: number,
  ): Promise<Stage3Result> {
    this.eventBus.publish(
      createTandemEvent(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_STARTED, {
        conversationId: params.conversationId,
        provider: params.refinementEngine,
      }),
    );

    // Build request body
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: STAGE_3_SYSTEM_PROMPT },
        { role: "user", content: params.payload },
      ],
    };

    if (params.byokCiphertext) {
      body.byokCiphertext = params.byokCiphertext;
      if (params.byokProvider) {
        body.byokProvider = params.byokProvider;
      }
    }

    let response: Response;

    try {
      response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: params.signal,
      });
    } catch (error: unknown) {
      // AbortError from signal
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("abort"))
      ) {
        return {
          content: "",
          partial: true,
          errorType: "cancelled",
        };
      }

      // Network failure
      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_FAILED, {
          conversationId: params.conversationId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return {
        content: "",
        partial: true,
        errorType: "network_failure",
      };
    }

    // Handle HTTP 429 — rate limited
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSeconds = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : undefined;

      // Auto-retry with exponential backoff
      if (params.autoRetryEnabled && attempt < RETRY_DELAYS_MS.length) {
        const waitMs =
          RETRY_DELAYS_MS[attempt] ??
          RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        try {
          await delay(waitMs, params.signal);
        } catch {
          return { content: "", partial: true, errorType: "cancelled" };
        }
        return this._executeWithRetry(params, attempt + 1);
      }

      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_FAILED, {
          conversationId: params.conversationId,
          error: "rate_limited",
        }),
      );
      return {
        content: "",
        partial: false,
        errorType: "rate_limited",
        ...(retryAfterSeconds !== undefined && !isNaN(retryAfterSeconds)
          ? { retryAfterSeconds }
          : {}),
      };
    }

    // Handle other HTTP errors
    if (!response.ok) {
      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_FAILED, {
          conversationId: params.conversationId,
          error: `HTTP ${response.status}`,
        }),
      );
      return {
        content: "",
        partial: true,
        errorType: "network_failure",
      };
    }

    // Check for BYOK ciphertext rotation header
    const rotatedCiphertext = response.headers.get("X-Byok-Rotated-Ciphertext");
    if (rotatedCiphertext) {
      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.BYOK_CIPHERTEXT_ROTATED, {
          conversationId: params.conversationId,
          newCiphertext: rotatedCiphertext,
        }),
      );
    }

    // Stream SSE response
    let fullText = "";
    let streamCompleted = false;

    if (!response.body) {
      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_FAILED, {
          conversationId: params.conversationId,
          error: "No response body",
        }),
      );
      return {
        content: "",
        partial: true,
        errorType: "network_failure",
      };
    }

    try {
      for await (const chunk of parseSSEStream(response.body, params.signal)) {
        fullText += chunk;
        params.onToken?.(chunk);

        this.eventBus.publish(
          createTandemEvent(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_STREAM, {
            conversationId: params.conversationId,
            chunk,
            fullText,
          }),
        );
      }
      streamCompleted = true;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("abort"))
      ) {
        return {
          content: fullText,
          partial: true,
          errorType: "cancelled",
        };
      }
      // Partial stream termination
      return {
        content: fullText,
        partial: true,
        errorType: "partial_stream",
      };
    }

    if (!streamCompleted) {
      return {
        content: fullText,
        partial: true,
        errorType: "partial_stream",
      };
    }

    this.eventBus.publish(
      createTandemEvent(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_COMPLETED, {
        conversationId: params.conversationId,
        content: fullText,
      }),
    );

    return {
      content: fullText,
      partial: false,
    };
  }
}
