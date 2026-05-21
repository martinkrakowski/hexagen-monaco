import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE_LOOSE_SPEC_CONVERSION_SYSTEM_PROMPT,
  compileLooseSpecConversionPrompt,
  buildLooseSpecRetryPrompt,
} from "../../../domain/prompts/convert-loose-spec.prompt";
import type { StructuredConfig } from "./execute-structured-config-generation.use-case";
import { parseStructuredConfig } from "./execute-structured-config-generation.use-case";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import { jsonrepair } from "jsonrepair";

const STAGE_NUMBER = 0; // Using 0 or a generic stage number since it's a standalone pipeline phase

export class ExecuteLooseSpecConversionUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    looseSpec: string,
    onChunk?: (chunk: string) => void,
  ): Promise<
    | { success: true; value: { configJson: string; config: StructuredConfig } }
    | { success: false; error: unknown }
  > {
    if (looseSpec.length > 200_000) {
      return err(new Error("Input too large (exceeds 200,000 characters)."));
    }

    let prompt = compileLooseSpecConversionPrompt(looseSpec);
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort(), 1800000); // 30min timeout per attempt

      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          {
            role: "system",
            content: STAGE_LOOSE_SPEC_CONVERSION_SYSTEM_PROMPT,
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
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(
            thrownError instanceof Error
              ? thrownError
              : new Error(String(thrownError)),
          );
        }
        if (thrownError instanceof Error && thrownError.name === "AbortError") {
          return err(thrownError);
        }
        lastError = `Request error: ${thrownError instanceof Error ? thrownError.message : String(thrownError)}`;
        continue;
      } finally {
        clearTimeout(timeoutHandle);
      }

      let fullResponse = "";
      let streamError: unknown = null;

      if (!responseResult.success) {
        streamError = responseResult.error;
      } else {
        fullResponse = responseResult.value.content;
        if (onChunk && fullResponse) {
          onChunk(fullResponse);
        }
      }

      if (streamError) {
        const errorMsg = `Request error: ${streamError}`;
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(
            new StageMaxRetriesError(STAGE_NUMBER, errorMsg, fullResponse),
          );
        }
        lastError = errorMsg;
        continue;
      }

      const cleanedResponse = fullResponse
        .replace(/^```json/m, "")
        .replace(/```$/m, "")
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
        return ok({
          configJson: JSON.stringify(parsedConfig, null, 2),
          config: parsedConfig,
        });
      }

      lastError = parseErrorStr;
      if (attempt === MAX_RETRY_ATTEMPTS) {
        return err(
          new StageMaxRetriesError(STAGE_NUMBER, lastError, fullResponse),
        );
      }

      prompt = buildLooseSpecRetryPrompt({
        attempt: attempt + 1,
        failedOutput: fullResponse,
        errorDetail: parseErrorStr,
        originalPrompt: prompt,
      });
    }

    return err(new StageMaxRetriesError(STAGE_NUMBER, lastError, ""));
  }
}
