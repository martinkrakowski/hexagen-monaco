import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type {
  ProjectDescription,
  GeneratedManifest,
  GenerationMetadata,
} from "../../domain/value-objects/index";
import { ProjectDescriptionValidator } from "../../domain/value-objects/index";
import { createGeneratedManifest } from "../../domain/value-objects/index";
import {
  generateSuggestions,
  detectWarnings,
} from "../../domain/manifest-yaml-extractor";
import {
  ManifestWarningCategory,
  type ManifestWarning,
  type GenerateManifestFromDescriptionRequest,
  type GenerateManifestFromDescriptionResponse,
} from "./generate-manifest-types";
import { ExecuteStagedGenerationUseCase } from "./staged-generation/execute-staged-generation.use-case";
import type { PromptVariables } from "../../domain/prompts/generate-manifest.prompt";
import type { TransactionManagerPort } from "@hexagen/transaction-system";

export { ManifestWarningCategory } from "./generate-manifest-types";

export class GenerateManifestFromDescriptionUseCase {
  private readonly stagedUseCase: ExecuteStagedGenerationUseCase;
  private readonly transactionManager?: TransactionManagerPort;

  constructor(
    private readonly llmPipeline: SendStructuredRequestPort,
    transactionManager?: TransactionManagerPort,
  ) {
    this.transactionManager = transactionManager;
    this.stagedUseCase = new ExecuteStagedGenerationUseCase(
      llmPipeline,
      transactionManager!,
    );
  }

  async execute(
    request: GenerateManifestFromDescriptionRequest,
  ): Promise<GenerateManifestFromDescriptionResponse> {
    try {
      ProjectDescriptionValidator.validate(request.description);

      const startTime = Date.now();
      const warnings: ManifestWarning[] = [];

      const variables: PromptVariables = {
        userDescription: request.description.text,
        platform: request.description.platform,
        deployment: request.description.deployment,
        additionalContext: request.description.additionalContext,
      };

      const result = await this.stagedUseCase.execute(
        request.description.text,
        variables,
      );

      if (!result.success) {
        const errorMsg =
          typeof result.error === "string"
            ? result.error
            : result.error instanceof Error
              ? result.error.message
              : "Staged generation failed";
        return {
          success: false,
          error: errorMsg,
        };
      }

      const { state, validation } = result;
      const manifestYaml = state.stage5?.yaml || "";

      if (validation.errors.length > 0) {
        for (const err of validation.errors) {
          warnings.push({
            category: ManifestWarningCategory.MISSING_CONTEXTS,
            message: err,
            suggestedAction: "manual-edit",
          });
        }
      }

      for (const w of validation.warnings) {
        const category = w.includes("Port data invalid")
          ? ManifestWarningCategory.MISSING_PORTS
          : ManifestWarningCategory.MISSING_ADAPTERS;
        warnings.push({
          category,
          message: w,
          suggestedAction: "manual-edit",
        });
      }

      const processingTime = Date.now() - startTime;
      const suggestions = generateSuggestions(manifestYaml);
      const yamlWarnings = detectWarnings(manifestYaml);

      const metadata: GenerationMetadata = {
        model: "fake-llm-mock",
        promptVersion: "2.0.0",
        generatedAt: new Date(),
        processingTime,
        tokensUsed: 0,
      };

      const manifest = createGeneratedManifest(manifestYaml, metadata, {
        suggestions,
        warnings: yamlWarnings,
      });

      return {
        success: true,
        manifest,
        warnings: warnings.length > 0 ? warnings : undefined,
        diagnostics: {
          totalAttempts: 1,
          tokensUsed: 0,
          processingTime,
          repairApplied: false,
          model: "fake-llm-mock",
        },
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
