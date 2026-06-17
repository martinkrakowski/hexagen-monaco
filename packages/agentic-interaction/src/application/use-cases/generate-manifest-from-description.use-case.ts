import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { GenerationMetadata } from "../../domain/value-objects/index";
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
import { ExecuteFullStagedGenerationUseCase } from "./staged-generation/execute-full-staged-generation.use-case";
import type { Stage6ReviewerConfig } from "./staged-generation/execute-validation-review.use-case";
import type { PromptVariables } from "../../domain/prompts/generate-manifest.prompt";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import type { TransactionManagerPort } from "@hexagen/transaction-system";

export { ManifestWarningCategory } from "./generate-manifest-types";

export class GenerateManifestFromDescriptionUseCase {
  // A4: the full 0→6 pipeline is now the only pipeline. This non-streaming
  // entry runs it without callbacks and collects the final state.
  private readonly stagedUseCase: ExecuteFullStagedGenerationUseCase;

  constructor(
    private readonly llmPipeline: SendStructuredRequestPort,
    transactionManager?: TransactionManagerPort,
    // Optional dedicated Stage-6 reviewer — same seam as the streaming
    // orchestrators, so this non-streaming entry (/api/manifest/generate and
    // /local) isn't silently left on the main model when STAGE6_VALIDATOR_* is
    // set. Off ⇒ Stage 6 on the main pipeline model at 800, unchanged.
    stage6Reviewer?: Stage6ReviewerConfig,
  ) {
    // A4: the full pipeline requires a transaction manager (begin→transition),
    // unlike the old stub which guarded an optional one. Non-web callers
    // (scripts, tests) may omit it, so default to a throwaway in-memory manager
    // rather than crash on `undefined.begin()`. This non-streaming entry never
    // surfaces the transactionId, so an ephemeral manager is correct.
    this.stagedUseCase = new ExecuteFullStagedGenerationUseCase(
      llmPipeline,
      transactionManager ?? new InMemoryTransactionManager(),
      stage6Reviewer ? { stage6Reviewer } : undefined,
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

      const { state } = result;
      // A4: the full pipeline reports validation in state.stage6 (the Stage-6
      // review), not as a top-level field like the old stub did.
      const validation = state.stage6 ?? { errors: [], warnings: [] };
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
