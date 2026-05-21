/* eslint-disable no-console */
import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  LOOSE_SPEC_CONVERSION_SYSTEM_PROMPT,
  compileLooseSpecConversionPrompt,
  buildLooseSpecRetryPrompt,
} from "../../../domain/prompts/convert-loose-spec.prompt";
import type { StructuredConfig } from "./execute-structured-config-generation.use-case";
import { parseStructuredConfig } from "./execute-structured-config-generation.use-case";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import { jsonrepair } from "jsonrepair";
import { DEFAULT_ESCALATION_CONFIG } from "./retry-with-escalation";
import type { EscalationConfig } from "./retry-with-escalation";

export const MAX_LOOSE_SPEC_INPUT_CHARS = 200_000;

// Use a sentinel that does not collide with staged generation stages 0-6.
// Telemetry filtering by stage number must be able to distinguish conversion
// failures from prompt-normalization (Stage 0) failures.
const LOOSE_SPEC_CONVERSION_STAGE = -1;

const ATTEMPT_TIMEOUT_MS = 1_800_000; // 30 minutes per attempt

const LOG_PREFIX = "[loose-spec-convert]";

export interface LooseSpecConversionCallbacks {
  onChunk?: (chunk: string) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export class ExecuteLooseSpecConversionUseCase {
  constructor(
    private readonly llmPort: SendStructuredRequestPort,
    private readonly escalationConfig: EscalationConfig = DEFAULT_ESCALATION_CONFIG,
  ) {}

  async execute(
    looseSpec: string,
    callbacks?: LooseSpecConversionCallbacks,
  ): Promise<
    | { success: true; value: { configJson: string; config: StructuredConfig } }
    | { success: false; error: unknown }
  > {
    if (looseSpec.length > MAX_LOOSE_SPEC_INPUT_CHARS) {
      return err(
        new Error(
          `Input too large (exceeds ${MAX_LOOSE_SPEC_INPUT_CHARS.toLocaleString()} characters).`,
        ),
      );
    }

    // Honour an already-aborted external signal before any work.
    if (callbacks?.signal?.aborted) {
      const abortErr = new Error("AbortError");
      abortErr.name = "AbortError";
      return err(abortErr);
    }

    const initialPrompt = compileLooseSpecConversionPrompt(looseSpec);
    let prompt = initialPrompt;
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      console.log(
        `${LOG_PREFIX} phase=conversion, attempt=${attempt}, maxTokens=8000`,
      );
      callbacks?.onProgress?.(`Converting (attempt ${attempt})...`);

      // Compose external + internal abort. The internal controller fires on
      // 30-min timeout; the external signal lets callers cancel mid-flight.
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(
        () => abortController.abort(),
        ATTEMPT_TIMEOUT_MS,
      );
      const externalSignal = callbacks?.signal;
      const onExternalAbort = () => abortController.abort();
      if (externalSignal) {
        if (externalSignal.aborted) {
          abortController.abort();
        } else {
          externalSignal.addEventListener("abort", onExternalAbort, {
            once: true,
          });
        }
      }

      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          {
            role: "system",
            content: LOOSE_SPEC_CONVERSION_SYSTEM_PROMPT,
          },
          { role: "user", content: prompt },
        ],
        z.string(),
        { stream: true, temperature: 0.1, maxTokens: 8000 },
      );
      request.signal = abortController.signal;

      let responseResult;
      try {
        responseResult = await this.llmPort.sendRequest(request);
      } catch (thrownError) {
        const isAbort =
          thrownError instanceof Error && thrownError.name === "AbortError";
        if (isAbort) {
          console.log(
            `${LOG_PREFIX} phase=conversion, attempt=${attempt}, aborted=true`,
          );
          return err(thrownError);
        }
        console.log(
          `${LOG_PREFIX} phase=conversion, attempt=${attempt}, llmFailed=true`,
        );
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(
            thrownError instanceof Error
              ? thrownError
              : new Error(String(thrownError)),
          );
        }
        lastError = `Request error: ${thrownError instanceof Error ? thrownError.message : String(thrownError)}`;
        continue;
      } finally {
        clearTimeout(timeoutHandle);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", onExternalAbort);
        }
      }

      if (callbacks?.signal?.aborted) {
        const abortErr = new Error("AbortError");
        abortErr.name = "AbortError";
        return err(abortErr);
      }

      let fullResponse = "";
      let streamError: unknown = null;

      if (!responseResult.success) {
        streamError = responseResult.error;
      } else {
        fullResponse = responseResult.value.content;
        if (callbacks?.onChunk && fullResponse) {
          callbacks.onChunk(fullResponse);
        }
      }

      if (streamError) {
        const errorMsg = `Request error: ${streamError}`;
        console.log(
          `${LOG_PREFIX} phase=conversion, attempt=${attempt}, streamError=true`,
        );
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(
            new StageMaxRetriesError(
              LOOSE_SPEC_CONVERSION_STAGE,
              errorMsg,
              fullResponse,
            ),
          );
        }
        lastError = errorMsg;
        continue;
      }

      // Strip fenced code blocks if present (handles ```json...``` and ```...```).
      const cleanedResponse = fullResponse
        .replace(/^[ \t]*```(?:json)?\s*/gim, "")
        .replace(/```\s*$/gm, "")
        .trim();

      let parsedConfig: StructuredConfig | null = null;
      let parseErrorStr = "";

      try {
        const repaired = jsonrepair(cleanedResponse);
        parsedConfig = parseStructuredConfig(repaired);
      } catch (e) {
        parseErrorStr = e instanceof Error ? e.message : String(e);
      }

      if (parsedConfig) {
        console.log(
          `${LOG_PREFIX} phase=conversion, attempt=${attempt}, success=true`,
        );
        return ok({
          configJson: JSON.stringify(parsedConfig, null, 2),
          config: parsedConfig,
        });
      }

      console.log(
        `${LOG_PREFIX} phase=conversion, attempt=${attempt}, parseFailed=true, error=${parseErrorStr.slice(0, 200)}`,
      );
      lastError = parseErrorStr;
      if (attempt === MAX_RETRY_ATTEMPTS) {
        return err(
          new StageMaxRetriesError(
            LOOSE_SPEC_CONVERSION_STAGE,
            lastError,
            fullResponse,
          ),
        );
      }

      prompt = buildLooseSpecRetryPrompt({
        attempt: attempt + 1,
        failedOutput: fullResponse,
        errorDetail: parseErrorStr,
        originalPrompt: initialPrompt,
      });
    }

    return err(
      new StageMaxRetriesError(LOOSE_SPEC_CONVERSION_STAGE, lastError, ""),
    );
  }
}
