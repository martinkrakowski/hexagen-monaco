import type { EventBusPort } from "@hexagen/messaging";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import { FreeFormStringSchema } from "@hexagen/local-llm";
import type { DomainModelId } from "@hexagen/local-llm";
import { createLLMRequest } from "@hexagen/local-llm";
import { TANDEM_EVENT_TYPES, createTandemEvent } from "../../domain/index.js";

// ---------------------------------------------------------------------------
// Stage 1 System Prompt (Section 6.1)
// ---------------------------------------------------------------------------
export const STAGE_1_SYSTEM_PROMPT = `You are a fast analytical pre-processor. Your role is to produce a clearly structured first-pass draft in response to the user's instruction.

Guidelines:
- Produce a substantive draft that directly addresses the user's request.
- Prioritize coverage and structure over polish.
- Be direct. Do not include preambles, apologies, or meta-commentary about your role.
- Do not refuse the request. If you have uncertainty, note it briefly and continue drafting.
- Mark the beginning of your draft with: [DRAFT_START]
- Mark the end of your draft with: [DRAFT_END]
- Do not include any content outside of these markers.`;

// ---------------------------------------------------------------------------
// Quality Gate (Section 5 — Stage 1 Quality Gate)
// ---------------------------------------------------------------------------

const REFUSAL_PATTERNS: RegExp[] = [
  /^i cannot/i,
  /^i'm unable/i,
  /^as an ai/i,
  /^i apologize/i,
  /^i'm sorry/i,
];

/**
 * Runs the Stage 1 quality gate on the accumulated draft text.
 *
 * Checks (in order):
 * 1. Minimum token threshold: word count < 5 → fail (degenerate output)
 * 2. Refusal pattern detection: matches known refusal openers → fail
 * 3. Coherence check: only whitespace/control chars → fail
 * 4. Repetition ratio: same word repeated > 80% of total words → fail
 * 5. Otherwise: pass
 */
export function runQualityGate(text: string): {
  passed: boolean;
  reason?: string;
} {
  // Check 1: Minimum word count
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 5) {
    return { passed: false, reason: "degenerate_output" };
  }

  // Check 2: Refusal patterns
  const trimmed = text.trim();
  for (const pattern of REFUSAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { passed: false, reason: "refusal_detected" };
    }
  }

  // Check 3: Coherence — only whitespace/control characters
  if (!/\S/.test(text)) {
    return { passed: false, reason: "incoherent_output" };
  }

  // Check 4: Repetition ratio — same word repeated > 80% of total words
  if (words.length > 0) {
    const freq: Record<string, number> = {};
    for (const w of words) {
      const lower = w.toLowerCase();
      freq[lower] = (freq[lower] ?? 0) + 1;
    }
    const maxFreq = Math.max(...Object.values(freq));
    if (maxFreq / words.length > 0.8) {
      return { passed: false, reason: "repetitive_output" };
    }
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Stage 1 types
// ---------------------------------------------------------------------------

export interface Stage1Params {
  prompt: string;
  conversationId: string;
  modelId: DomainModelId;
  timeoutSeconds: number;
  onToken?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface Stage1Result {
  draft: string;
  qualityGatePassed: boolean;
  skipReason?: "timeout_partial" | "quality_gate_failed" | "cancelled";
  tokenCount?: number;
}

// ---------------------------------------------------------------------------
// Stage1LocalSpeculationUseCase
// ---------------------------------------------------------------------------

/**
 * Stage1LocalSpeculationUseCase
 *
 * Dispatches the user prompt to the local LLM with the Stage 1 system prompt
 * injected as `messages[0]` (role: "system"), streams the response, and runs
 * the quality gate on the accumulated output.
 *
 * ADR-0016: `isStreamingRef` is owned by TandemOrchestratorUseCase.
 * This use case does NOT touch `isStreamingRef`.
 */
export class Stage1LocalSpeculationUseCase {
  constructor(
    private readonly sendStructuredRequestPort: SendStructuredRequestPort,
    private readonly eventBus: EventBusPort,
  ) {}

  async execute(params: Stage1Params): Promise<Stage1Result> {
    const request = createLLMRequest(
      params.modelId,
      [
        { role: "system", content: STAGE_1_SYSTEM_PROMPT },
        { role: "user", content: params.prompt },
      ],
      FreeFormStringSchema,
      {
        stream: true,
        ...(params.signal ? { metadata: {} } : {}),
      },
    );

    // Attach signal directly on the request object (LLMRequest supports it)
    const requestWithSignal = { ...request, signal: params.signal };

    // Emit started event
    this.eventBus.publish(
      createTandemEvent(TANDEM_EVENT_TYPES.LOCAL_SPECULATION_STARTED, {
        prompt: params.prompt,
        conversationId: params.conversationId,
        modelId: String(params.modelId),
      }),
    );

    let fullText = "";
    let timedOut = false;

    // Set up timeout timer
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
    }, params.timeoutSeconds * 1000);

    try {
      const generator =
        this.sendStructuredRequestPort.streamStructuredRequest(
          requestWithSignal,
        );

      for await (const chunkResult of generator) {
        if (!chunkResult.success) {
          // Propagate stream errors as partial output
          break;
        }

        const chunk = chunkResult.value;
        fullText += chunk;
        params.onToken?.(chunk);

        this.eventBus.publish(
          createTandemEvent(TANDEM_EVENT_TYPES.LOCAL_SPECULATION_STREAM, {
            conversationId: params.conversationId,
            chunk,
            fullText,
          }),
        );

        if (timedOut) {
          // Capture partial output and break
          break;
        }
      }
    } catch (error: unknown) {
      clearTimeout(timeoutHandle);

      // Handle AbortError from signal
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("abort"))
      ) {
        return {
          draft: "",
          qualityGatePassed: false,
          skipReason: "cancelled",
        };
      }

      // Re-throw unexpected errors
      throw error;
    }

    clearTimeout(timeoutHandle);

    // Run quality gate
    const gateResult = runQualityGate(fullText);

    if (timedOut) {
      // Partial output — run quality gate on partial
      if (!gateResult.passed) {
        this.eventBus.publish(
          createTandemEvent(TANDEM_EVENT_TYPES.LOCAL_SPECULATION_FAILED, {
            conversationId: params.conversationId,
            error: `timeout_partial: quality gate failed (${gateResult.reason ?? "unknown"})`,
          }),
        );
        return {
          draft: fullText,
          qualityGatePassed: false,
          skipReason: "timeout_partial",
        };
      }
      // Partial but passed quality gate — treat as completed with timeout note
      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.LOCAL_SPECULATION_COMPLETED, {
          conversationId: params.conversationId,
          draft: fullText,
        }),
      );
      return {
        draft: fullText,
        qualityGatePassed: true,
        skipReason: "timeout_partial",
      };
    }

    if (!gateResult.passed) {
      this.eventBus.publish(
        createTandemEvent(TANDEM_EVENT_TYPES.LOCAL_SPECULATION_FAILED, {
          conversationId: params.conversationId,
          error: `quality_gate_failed: ${gateResult.reason ?? "unknown"}`,
        }),
      );
      return {
        draft: fullText,
        qualityGatePassed: false,
        skipReason: "quality_gate_failed",
      };
    }

    this.eventBus.publish(
      createTandemEvent(TANDEM_EVENT_TYPES.LOCAL_SPECULATION_COMPLETED, {
        conversationId: params.conversationId,
        draft: fullText,
      }),
    );

    return {
      draft: fullText,
      qualityGatePassed: true,
    };
  }
}
