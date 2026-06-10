import { ok, err } from "@hexagen/shared";
import { STAGE_ATTEMPT_TIMEOUT_MS, stageTimeoutError } from "./stage-timeout";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE0_NORMALIZATION_SYSTEM_PROMPT,
  compileStage0Prompt,
} from "../../../domain/index";
import type { NormalizedPrompt } from "../../../domain/value-objects/pipeline-state";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry";

const STAGE_NUMBER = 0;

export class ExecutePromptNormalizationUseCase {
  // No escalationConfig here: only Stage 3 (ExecutePortMappingUseCase) reads
  // its escalation config; the param was a dead copy-paste in stages 0/1/2/4/6.
  //
  // architectureContext (T2b): trusted static `<architecture>` content,
  // constructor-injected so it is built once per pipeline, not per execute().
  constructor(
    private readonly llmPort: SendStructuredRequestPort,
    private readonly architectureContext?: string,
  ) {}

  async execute(
    userDescription: string,
    variables?: PromptVariables,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    | { success: true; value: NormalizedPrompt }
    | { success: false; error: unknown }
  > {
    const stageStart = Date.now();

    // Log generation start to generation log
    onChunk?.("Parsing and normalizing specification...");

    let prompt = compileStage0Prompt(
      variables || { userDescription },
      this.architectureContext,
    );
    let lastError = "";
    let retryCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      retryCount = attempt - 1;
      // Fail fast on the deadline (do not retry a timeout); transient errors
      // below still retry.
      let isTimedOut = false;
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        isTimedOut = true;
        abortController.abort();
      }, STAGE_ATTEMPT_TIMEOUT_MS);

      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE0_NORMALIZATION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        { stream: true, temperature: 0.1, maxTokens: 800 },
      );
      request.signal = abortController.signal;

      let responseResult;
      try {
        responseResult = await this.llmPort.sendRequest(request);
      } catch (thrownError) {
        if (isTimedOut) {
          return err(
            stageTimeoutError("Prompt normalization", STAGE_ATTEMPT_TIMEOUT_MS),
          );
        }
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
        if (isTimedOut) {
          return err(
            stageTimeoutError("Prompt normalization", STAGE_ATTEMPT_TIMEOUT_MS),
          );
        }
        const errorMsg = `Request error: ${streamError}`;
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(
            new StageMaxRetriesError(STAGE_NUMBER, errorMsg, fullResponse),
          );
        }
        lastError = errorMsg;
        continue;
      }

      // Parse NDJSON output — strip markdown code fences first
      const cleanedResponse = fullResponse
        .split("\n")
        .filter((line) => !line.trim().startsWith("```"))
        .join("\n");

      const lines = cleanedResponse
        .split("\n")
        .filter((line) => line.trim() !== "");
      let intent = "";
      const explicitTechnologies: string[] = [];
      const explicitPatterns: string[] = [];
      const ambiguities: string[] = [];
      let projectName: string | undefined;
      let isStructuredConfig: boolean | undefined;
      let hasValidLine = false;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          hasValidLine = true;
          if (parsed.type === "intent") {
            intent = parsed.value;
          } else if (parsed.type === "technology") {
            explicitTechnologies.push(parsed.value);
          } else if (parsed.type === "pattern") {
            explicitPatterns.push(parsed.value);
          } else if (parsed.type === "ambiguity") {
            ambiguities.push(parsed.value);
          } else if (parsed.type === "projectName") {
            // Zero-or-one per the system prompt; guard the type since the
            // model may emit anything. Blank strings are as useless as none.
            // Store the trimmed value — it is what the guard validated, and
            // buildIntentHeader interpolates it verbatim into prompts.
            if (typeof parsed.value === "string" && parsed.value.trim()) {
              projectName = parsed.value.trim();
            }
          } else if (parsed.type === "isStructuredConfig") {
            // Only literal `true` is meaningful (the prompt says to omit the
            // object entirely for natural-language input).
            if (parsed.value === true) {
              isStructuredConfig = true;
            }
          }
        } catch {
          // Ignore malformed lines
        }
      }

      // Validate output
      const parseError = !hasValidLine
        ? "No valid NDJSON lines found in output"
        : !intent
          ? "Missing required 'intent' object in output"
          : "";

      if (!parseError) {
        const durationMs = Date.now() - stageStart;
        const result: NormalizedPrompt = {
          intent,
          explicitTechnologies,
          explicitPatterns,
          ambiguities,
          ...(projectName !== undefined ? { projectName } : {}),
          ...(isStructuredConfig !== undefined ? { isStructuredConfig } : {}),
        };
        onStageTelemetry?.({
          stage: STAGE_NUMBER,
          label: "Prompt Normalization",
          durationMs,
          usedLLM: true,
          retryCount,
          inputTokensEstimate: estimateTokenCount(prompt),
          outputTokensActual: estimateTokenCount(fullResponse),
          servedFromCache: false,
          summary: `Normalized intent: ${intent}, ${explicitTechnologies.length} technologies, ${ambiguities.length} ambiguities`,
        });
        return ok(result);
      }

      lastError = parseError;
      if (attempt === MAX_RETRY_ATTEMPTS) {
        return err(
          new StageMaxRetriesError(STAGE_NUMBER, lastError, fullResponse),
        );
      }

      // Build retry prompt
      prompt = buildStageRetryPrompt({
        stage: STAGE_NUMBER,
        attempt: attempt + 1,
        failedOutput: fullResponse,
        errorDetail: parseError,
        originalPrompt: prompt,
      }).content;
    }

    // Should never reach here
    return err(new StageMaxRetriesError(STAGE_NUMBER, lastError, ""));
  }
}
