import type { DecisionAdvicePort } from "../../application/ports/out/decision-advice.port";
import {
  buildState,
  parseChoiceAnswer,
  parseNoulAnswer,
} from "../../domain/decision-advice";
import type {
  DecisionAdviceRequest,
  DecisionAdviceResult,
  DecisionAnswer,
  DecisionReceipt,
  DecisionUnknownReason,
} from "../../domain/decision-advice";
import type { SecretVaultPort } from "../../domain/provider-config";
import { withLlmSpan } from "../telemetry/llm-span";

/**
 * The real Jev decision adapter (lane J1b). Server-only: exported from the
 * `./server` subpath, never from the `.` barrel (invariant 1).
 *
 * Hardening, per invariant 4 ("fail to today"):
 * - one deadline (default 3 s) covering both the request and the body read;
 * - the response body is read as a stream and cut off past 64 KiB;
 * - `redirect: "error"` — no redirects;
 * - the key is read per call through the injected `SecretVaultPort` and never
 *   appears in an error message, a receipt or a log line.
 *
 * Every expected failure resolves as an `unknown` reason; the adapter never
 * throws.
 */

const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = "typesafe/jev-1.14";
const JEV_API_KEY_NAME = "JEV_API_KEY";
const DEFAULT_TIMEOUT_MS = 3000;
const BODY_CAP_BYTES = 64 * 1024; // 64 KiB

/**
 * Fixed class-like tokens for `unknown` receipt reasons, so the
 * `jev.decision` span is marked ERROR with a closed-set token only — never
 * the receipt's message, the state or any question text.
 */
const RECEIPT_ERROR_TOKENS: Record<DecisionUnknownReason, string> = {
  disabled: "JevDisabled",
  refused: "JevRefused",
  budget: "JevBudget",
  timeout: "JevTimeout",
  http: "JevHttp",
  shape: "JevShape",
  tie: "JevTie",
  error: "JevError",
};

/**
 * `withLlmSpan`'s `failed` callback: an `unknown` receipt fails the span.
 * Only a receipt counts — `unknown` without one (disabled, error) made no
 * call and carries nothing to report, so those spans stay OK.
 */
function unknownReceiptToken(
  result: DecisionAdviceResult,
): { name: string } | undefined {
  if (result.status !== "unknown") return undefined;
  const receiptStatus = result.receipt?.status;
  if (receiptStatus === undefined || receiptStatus === "advised") {
    return undefined;
  }
  return { name: RECEIPT_ERROR_TOKENS[receiptStatus] };
}

export interface JevDecisionAdapterOptions {
  /** Secrets vault; the key is looked up per call as `JEV_API_KEY`. */
  secretVault: SecretVaultPort;
  /** Injectable fetch for tests; defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Whole-call deadline in milliseconds; default 3000. */
  timeoutMs?: number;
}

export class JevDecisionAdapter implements DecisionAdvicePort {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly secretVault: SecretVaultPort;
  private readonly timeoutMs: number;

  constructor(options: JevDecisionAdapterOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.secretVault = options.secretVault;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async ask(request: DecisionAdviceRequest): Promise<DecisionAdviceResult> {
    try {
      return await this.askOnce(request);
    } catch {
      // Never throws: anything unexpected (a synchronous throw from an
      // injected fetch, the vault, serialisation) is "no advice". The error
      // object is discarded so nothing from it can carry the key onward.
      return { status: "unknown", reason: "error" };
    }
  }

  private async askOnce(
    request: DecisionAdviceRequest,
  ): Promise<DecisionAdviceResult> {
    return withLlmSpan(
      "jev.decision",
      {
        "llm.provider": "openrouter",
        "llm.system": "openrouter",
        "llm.model_name": JEV_MODEL,
        "gen_ai.system": "openrouter",
        "gen_ai.request.model": JEV_MODEL,
        "gen_ai.operation.name": "decision",
      },
      async () => {
        const key = this.secretVault.getSecret(JEV_API_KEY_NAME);
        if (key === null) {
          return { status: "unknown", reason: "disabled" };
        }

        // One deadline for the whole call: the request and the body read share
        // a single AbortController (invariant 4).
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const startedAt = Date.now();

        try {
          const built = buildState(request.fields, "");
          if (!built.ok) {
            return { status: "unknown", reason: built.reason };
          }

          // The deadline aborts the controller; the race makes sure `ask`
          // resolves at the deadline even if the underlying fetch never
          // settles.
          const abortPromise = new Promise<Response | null | "http">(
            (resolve) => {
              controller.signal.addEventListener("abort", () => resolve(null), {
                once: true,
              });
            },
          );
          const response = await Promise.race([
            this.fetchImpl(JEV_ENDPOINT, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                // Sent once, here; never echoed back in any failure path.
                authorization: `Bearer ${key}`,
              },
              body: JSON.stringify({
                model: JEV_MODEL,
                state: built.state,
                questions: request.questions,
              }),
              redirect: "error",
              signal: controller.signal,
            }).catch((error: unknown): Response | null | "http" => {
              // The deadline won, not the network: timeout, not http.
              if (controller.signal.aborted) return null;
              if (
                error instanceof DOMException &&
                error.name === "AbortError"
              ) {
                return null;
              }
              // A redirect (`redirect: "error"`) or any other fetch-level
              // failure is a transport failure (`unknown/http`).
              return "http";
            }),
            abortPromise,
          ]);

          if (response === null) {
            return this.unknownReceipt(request, "timeout", startedAt);
          }
          if (response === "http") {
            return this.unknownReceipt(request, "http", startedAt);
          }
          if (!response.ok) {
            // Release the connection: an unread body holds the socket until GC.
            response.body?.cancel().catch(() => undefined);
            return this.unknownReceipt(request, "http", startedAt);
          }

          const bodyResult = await this.readBody(response, controller);
          if (bodyResult === "timeout") {
            return this.unknownReceipt(request, "timeout", startedAt);
          }
          if (bodyResult === "cap") {
            // Past the 64 KiB cap: the shape can no longer be trusted.
            return this.unknownReceipt(request, "shape", startedAt);
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(bodyResult) as unknown;
          } catch {
            return this.unknownReceipt(request, "shape", startedAt);
          }

          return this.parseAnswers(request, parsed, startedAt);
        } finally {
          clearTimeout(timer);
        }
      },
      unknownReceiptToken,
    );
  }

  /**
   * Read the response body as a stream under the same deadline, stopping at
   * the 64 KiB cap. Returns the text, `"cap"` when the body overflowed, or
   * `"timeout"` when the deadline aborted the read.
   */
  private async readBody(
    response: Response,
    controller: AbortController,
  ): Promise<string | "cap" | "timeout"> {
    const stream = response.body;
    if (stream === null) return "cap";

    const reader = stream.getReader();
    // The same deadline races every read, so a body stream that ignores the
    // signal still ends the call at the deadline (its reader is cancelled).
    const aborted = new Promise<"timeout">((resolve) => {
      if (controller.signal.aborted) resolve("timeout");
      controller.signal.addEventListener("abort", () => resolve("timeout"), {
        once: true,
      });
    });
    const decoder = new TextDecoder();
    let total = 0;
    let text = "";
    try {
      for (;;) {
        const next = await Promise.race([reader.read(), aborted]);
        if (next === "timeout") {
          reader.cancel().catch(() => undefined);
          return "timeout";
        }
        const { done, value } = next;
        if (done) break;
        total += value.byteLength;
        if (total > BODY_CAP_BYTES) {
          controller.abort();
          return "cap";
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } catch {
      // Aborted by the deadline (timeout) or the stream died mid-read.
      if (controller.signal.aborted) return "timeout";
      return "cap";
    }
  }

  /**
   * Validate every question's raw answer with the pure domain validators.
   * Any `shape`/`tie` rejection is the whole call's reason (invariant 4).
   */
  private parseAnswers(
    request: DecisionAdviceRequest,
    parsed: unknown,
    startedAt: number,
  ): DecisionAdviceResult {
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("answers" in parsed) ||
      typeof (parsed as { answers: unknown }).answers !== "object" ||
      (parsed as { answers: unknown }).answers === null
    ) {
      return this.unknownReceipt(request, "shape", startedAt);
    }

    const answers = (parsed as { answers: Record<string, unknown> }).answers;
    const validated: Record<string, DecisionAnswer> = {};

    for (const [id, question] of Object.entries(request.questions)) {
      const raw = answers[id];
      const result =
        question.type === "choice"
          ? parseChoiceAnswer(raw, Object.keys(question.criteria))
          : parseNoulAnswer(raw);
      if (!result.ok) {
        return this.unknownReceipt(request, result.reason, startedAt);
      }
      validated[id] = result.answer;
    }

    return {
      status: "advised",
      answers: validated,
      receipt: this.receipt(request, "advised", startedAt, parsed),
    };
  }

  private unknownReceipt(
    request: DecisionAdviceRequest,
    reason: "http" | "timeout" | "shape" | "tie" | "refused",
    startedAt: number,
  ): DecisionAdviceResult {
    return {
      status: "unknown",
      reason,
      receipt: this.receipt(request, reason, startedAt),
    };
  }

  /**
   * Closed-set, numeric-or-identifier receipt. Never carries the state, the
   * fields or the key (invariant 5).
   */
  private receipt(
    request: DecisionAdviceRequest,
    status: DecisionReceipt["status"],
    startedAt: number,
    parsed?: unknown,
  ): DecisionReceipt {
    const body =
      typeof parsed === "object" && parsed !== null
        ? (parsed as {
            id?: unknown;
            model?: unknown;
            usage?: { cost?: unknown };
          })
        : undefined;
    const cost = body?.usage?.["cost"];
    return {
      use: request.use,
      model:
        typeof body?.model === "string" && body.model !== ""
          ? body.model
          : JEV_MODEL,
      requestId: typeof body?.id === "string" ? body.id : "",
      generationId: "",
      status,
      costMicroUsd:
        typeof cost === "number" ? Math.round(cost * 1_000_000) : null,
      latencyMs: Date.now() - startedAt,
    };
  }
}
