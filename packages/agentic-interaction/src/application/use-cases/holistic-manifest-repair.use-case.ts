import type {
  SendStructuredRequestPort,
  LLMRequest,
  DomainModelId,
} from "@hexagen/local-llm";
import { createLLMRequest } from "@hexagen/local-llm";
import { z } from "zod";
import { extractYamlFromResponse } from "../../domain/manifest-yaml-extractor.js";

export interface HolisticManifestRepairRequest {
  fullManifestYaml: string;
  violationMessage: string;
}

export interface HolisticManifestRepairResponse {
  success: boolean;
  patchedYaml?: string;
  error?: string;
}

export class HolisticManifestRepairUseCase {
  constructor(private readonly llmPipeline: SendStructuredRequestPort) {}

  async execute(
    request: HolisticManifestRepairRequest,
  ): Promise<HolisticManifestRepairResponse> {
    try {
      const systemPrompt = `You are a strict architectural auto-fix agent.
Your task is to fix a cross-context validation error in the provided full Hexagonal Architecture Manifest YAML.
You MUST output the complete updated YAML for the entire manifest.
You MUST NOT alter any keys, contexts, or values that are unrelated to fixing the violation.
Do not add any explanations, only return the YAML.`;

      const userPrompt = `Here is the current full manifest YAML:
\`\`\`yaml
${request.fullManifestYaml}
\`\`\`

The following cross-context validation error was found:
${request.violationMessage}

Please fix the error by making the minimal necessary changes across the affected bounded contexts and return the complete updated YAML.`;

      const llmRequest = createLLMRequest(
        "gpt-4" as DomainModelId, // Default model
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        z.string(),
        {
          temperature: 0.1,
          maxTokens: 4000,
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
            : "Unknown error during holistic manifest repair",
      };
    }
  }
}
