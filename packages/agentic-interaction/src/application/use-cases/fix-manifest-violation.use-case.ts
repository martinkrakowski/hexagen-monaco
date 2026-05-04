import type {
  SendStructuredRequestPort,
  DomainModelId,
} from "@hexagen/local-llm";
import { createLLMRequest } from "@hexagen/local-llm";
import { z } from "zod";
import { extractYamlFromResponse } from "../../domain/manifest-yaml-extractor.js";

export interface FixManifestViolationRequest {
  contextYaml: string;
  violationMessage: string;
}

export interface FixManifestViolationResponse {
  success: boolean;
  patchedYaml?: string;
  error?: string;
}

export class FixManifestViolationUseCase {
  constructor(private readonly llmPipeline: SendStructuredRequestPort) {}

  async execute(
    request: FixManifestViolationRequest,
  ): Promise<FixManifestViolationResponse> {
    try {
      const systemPrompt = `You are a strict architectural auto-fix agent.
Your task is to fix a validation error in the provided Hexagonal Architecture Bounded Context YAML.
You MUST output the complete updated YAML for this bounded context.
You MUST NOT alter any keys or values that are unrelated to the violation.
Do not add any explanations, only return the YAML.`;

      const userPrompt = `Here is the bounded context YAML:
\`\`\`yaml
${request.contextYaml}
\`\`\`

The following validation error was found:
${request.violationMessage}

Please fix the error by making the minimal necessary changes to the YAML and return the complete updated YAML.`;

      const llmRequest = createLLMRequest(
        "gpt-4" as DomainModelId, // Default model
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        z.string(),
        {
          temperature: 0.1,
          maxTokens: 2000,
        },
      );

      const result = await this.llmPipeline.sendRequest(llmRequest);

      if (!result.success) {
        return {
          success: false,
          error:
            result.error instanceof Error
              ? result.error.message
              : "LLM request failed",
        };
      }

      const llmResponse = result.value;
      const patchedYaml = extractYamlFromResponse(llmResponse.content);

      if (!patchedYaml || patchedYaml.trim().length === 0) {
        return {
          success: false,
          error: "Failed to extract valid YAML from LLM response",
        };
      }

      return {
        success: true,
        patchedYaml,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error during manifest repair",
      };
    }
  }
}
