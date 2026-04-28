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
} from "../../domain/value-objects";
import { ProjectDescriptionValidator } from "../../domain/value-objects";
import { createGeneratedManifest } from "../../domain/value-objects";
import { compilePrompt } from "../../domain/prompts/generate-manifest.prompt";

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
      const manifestYaml = this.extractYamlFromResponse(llmResponse.content);

      // Validate extracted YAML
      if (!manifestYaml || manifestYaml.trim().length === 0) {
        return {
          success: false,
          error: "Failed to extract valid YAML from LLM response",
        };
      }

      // Collect suggestions and warnings
      const suggestions = this.generateSuggestions(manifestYaml);
      const warnings = this.detectWarnings(manifestYaml);

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

  /**
   * Extract YAML content from LLM response
   * Handles various response formats (code blocks, plain text, etc.)
   */
  private extractYamlFromResponse(response: string): string {
    // Try to extract from code block first
    const codeBlockMatch = response.match(/```ya?ml\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try generic code block
    const genericBlockMatch = response.match(/```\n([\s\S]*?)\n```/);
    if (genericBlockMatch) {
      const content = genericBlockMatch[1].trim();
      // Verify it looks like YAML
      if (
        content.includes("workspace:") ||
        content.includes("boundedContexts:")
      ) {
        return content;
      }
    }

    // If no code block, check if the entire response is YAML
    if (
      response.includes("workspace:") &&
      response.includes("boundedContexts:")
    ) {
      return response.trim();
    }

    // Last resort: try to find YAML-like content
    const lines = response.split("\n");
    const yamlStart = lines.findIndex(
      (line) =>
        line.trim().startsWith("workspace:") || line.trim().startsWith("# "),
    );
    if (yamlStart !== -1) {
      return lines.slice(yamlStart).join("\n").trim();
    }

    return "";
  }

  /**
   * Generate helpful suggestions based on manifest content
   */
  private generateSuggestions(manifest: string): string[] {
    const suggestions: string[] = [];

    // Check for common improvements
    if (!manifest.includes("description:")) {
      suggestions.push("Consider adding descriptions to your bounded contexts");
    }

    if (!manifest.includes("adapters:")) {
      suggestions.push("You may want to define adapters for your ports");
    }

    if (!manifest.includes("dependencies:")) {
      suggestions.push("Consider defining dependencies between contexts");
    }

    if (manifest.split("boundedContexts:")[1]?.split("-").length === 2) {
      suggestions.push(
        "Single context detected - consider if domain decomposition is needed",
      );
    }

    return suggestions;
  }

  /**
   * Detect potential issues or warnings in generated manifest
   */
  private detectWarnings(manifest: string): string[] {
    const warnings: string[] = [];

    // Check for incomplete sections
    if (manifest.includes("TODO") || manifest.includes("FIXME")) {
      warnings.push(
        "Manifest contains TODO/FIXME markers - manual review needed",
      );
    }

    // Check for placeholder values
    if (manifest.includes("example.com") || manifest.includes("placeholder")) {
      warnings.push("Manifest may contain placeholder values");
    }

    // Check for very short contexts (likely incomplete)
    const contextMatches = manifest.match(/- name: [^\n]+/g);
    if (contextMatches && contextMatches.length > 5) {
      warnings.push(
        "Large number of contexts detected - consider consolidation",
      );
    }

    // Check for missing critical sections
    if (!manifest.includes("ports:")) {
      warnings.push(
        "No ports defined - hexagonal architecture may be incomplete",
      );
    }

    return warnings;
  }
}

// Made with Bob
