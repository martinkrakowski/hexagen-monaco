/**
 * Use case for generating manifest.yaml from natural language description
 */

import type {
  SendStructuredRequestPort,
  LLMRequest,
  DomainModelId,
} from "@hexagen/local-llm";
import { createLLMRequest } from "@hexagen/local-llm";
import { z } from "zod";
import type {
  ProjectDescription,
  GeneratedManifest,
  GenerationMetadata,
} from "../../domain/value-objects/index.js";
import { ProjectDescriptionValidator } from "../../domain/value-objects/index.js";
import { createGeneratedManifest } from "../../domain/value-objects/index.js";
import { compilePrompt } from "../../domain/prompts/generate-manifest.prompt.js";
import {
  extractYamlFromResponse,
  generateSuggestions,
  detectWarnings,
} from "../../domain/manifest-yaml-extractor.js";

export interface GenerateManifestFromDescriptionRequest {
  description: ProjectDescription;
}

export interface GenerateManifestFromDescriptionResponse {
  success: boolean;
  manifest?: GeneratedManifest;
  error?: string;
}

export class GenerateManifestFromDescriptionUseCase {
  constructor(private readonly llmPipeline: SendStructuredRequestPort) {}

  async execute(
    request: GenerateManifestFromDescriptionRequest,
  ): Promise<GenerateManifestFromDescriptionResponse> {
    try {
      // Validate input
      ProjectDescriptionValidator.validate(request.description);

      // Compile prompts
      const { system, user } = compilePrompt({
        userDescription: request.description.text,
        platform: request.description.platform,
        deployment: request.description.deployment,
        additionalContext: request.description.additionalContext,
      });

      // Track start time
      const startTime = Date.now();

      // Build LLM request with messages format
      const llmRequest = createLLMRequest(
        "gpt-4" as DomainModelId, // Default model, can be overridden
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        z.string(), // Simple string schema for YAML output
        {
          temperature: 0.3, // Lower temperature for more deterministic output
          maxTokens: 4000, // Enough for a complete manifest
        },
      );

      // Call LLM pipeline
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

      // Calculate processing time
      const processingTime = Date.now() - startTime;

      // Extract YAML from response
      const manifestYaml = extractYamlFromResponse(llmResponse.content);

      // Validate extracted YAML
      if (!manifestYaml || manifestYaml.trim().length === 0) {
        return {
          success: false,
          error: "Failed to extract valid YAML from LLM response",
        };
      }

      // Collect suggestions and warnings
const suggestions = generateSuggestions(manifestYaml);
const warnings = detectWarnings(manifestYaml);

      // Create generation metadata
      const metadata: GenerationMetadata = {
        model: llmResponse.modelId || "unknown",
        promptVersion: "1.0.0",
        generatedAt: new Date(),
        processingTime,
        tokensUsed: llmResponse.usage?.totalTokens || 0,
      };

      // Create generated manifest
      const manifest = createGeneratedManifest(manifestYaml, metadata, {
        suggestions,
        warnings,
      });

      return {
        success: true,
        manifest,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error during manifest generation",
      };
    }
  }


}

// Made with Bob
