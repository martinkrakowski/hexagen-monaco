import type {
  ServerLLMRequestPort,
  ServerLLMRequest,
  ServerLLMUserInfo,
} from "../ports/in/ServerLLMRequestPort";
import type {
  LLMProviderPort,
  LLMCompletionRequest,
} from "../../domain/ports/llm-provider.port";

/**
 * Some providers — notably the diffusion-based `inception:mercury-*` models on
 * the cloud chat path — intermittently return a *zero-content* completion: the
 * stream finishes cleanly with no chunks and no error (empirically ~1/3 of
 * longer requests, correlated with a multi-second upstream stall). Left
 * unhandled, the route streams only `data: {type:"done"}` and the client renders
 * an empty assistant bubble — the "text is sent but no response comes back" bug.
 *
 * We retry a few times on an empty completion before giving up, mirroring the
 * staged-generation pipeline's `emptyResponse → retry` guard (see
 * `llm-retry.ts`). Retrying is only safe *before* any content reaches the client;
 * once a chunk is streamed we commit to that attempt (the transcript can't be
 * un-sent). The prod edge tolerates long requests (Apache `Timeout 300`), so a
 * handful of sequential attempts stays well within budget.
 */
const DEFAULT_MAX_ATTEMPTS = 3;

export class HandleServerChatUseCase implements ServerLLMRequestPort {
  private readonly maxAttempts: number;

  constructor(
    private readonly llmProvider: LLMProviderPort,
    private readonly defaultModel: string,
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  ) {
    // Always make at least one attempt; coerce a misconfigured value (NaN,
    // Infinity, fractional, 0/negative) to a finite sane integer rather than
    // silently disabling all attempts — `Math.max(1, NaN)` is `NaN`, which
    // makes `attempt <= maxAttempts` always false (zero attempts).
    this.maxAttempts = Number.isFinite(maxAttempts)
      ? Math.max(1, Math.floor(maxAttempts))
      : DEFAULT_MAX_ATTEMPTS;
  }

  async handleRequest(
    request: ServerLLMRequest,
    _userInfo: ServerLLMUserInfo, // userInfo reserved for future fine-grained ACLs / logging via injected LoggerPort
  ): Promise<ReadableStream<Uint8Array>> {
    const completionRequest: LLMCompletionRequest = {
      model: this.defaultModel,
      messages: request.messages as Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>,
    };

    const provider = this.llmProvider;
    const maxAttempts = this.maxAttempts;
    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        const send = (frame: Record<string, unknown>) =>
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(frame)}\n\n`),
          );

        try {
          // `pendingError` carries the single error frame to emit before `done`:
          // a hard provider error, a trailing mid-stream error, or — after every
          // attempt came back empty — the empty-response message.
          let emittedContent = false;
          let pendingError: string | null = null;

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let attemptEmitted = false;
            let attemptError: string | null = null;

            for await (const result of provider.streamComplete(
              completionRequest,
            )) {
              if (result.success) {
                if (!result.value) continue; // skip empty deltas
                attemptEmitted = true;
                emittedContent = true;
                send({ type: "chunk", content: result.value });
              } else {
                attemptError =
                  result.error instanceof Error
                    ? result.error.message
                    : String(result.error);
                break;
              }
            }

            if (attemptEmitted) {
              // Content reached the client — commit to this attempt. Surface any
              // trailing mid-stream error (parity with the prior behavior).
              pendingError = attemptError;
              break;
            }
            if (attemptError) {
              // A hard provider error with no content (bad key, quota, policy).
              // Retrying is unlikely to help and would mask the cause — surface
              // it rather than burn attempts on a deterministic failure.
              pendingError = attemptError;
              break;
            }
            // Empty completion (no content, no error): the provider's
            // empty-output mode. Retry if attempts remain; otherwise this message
            // is what the client will show.
            pendingError = `The model returned an empty response after ${attempt} ${
              attempt === 1 ? "attempt" : "attempts"
            }. Please try again.`;
          }

          if (pendingError) send({ type: "error", message: pendingError });
          send({ type: "done" });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          send({ type: "error", message: errorMsg });
          // Terminate the stream consistently with the normal error paths
          // (every stream ends with `done`).
          send({ type: "done" });
        } finally {
          controller.close();
        }
      },
    });

    return readableStream;
  }
}
