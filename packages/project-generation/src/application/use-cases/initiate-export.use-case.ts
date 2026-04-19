import type { Result } from "@hexagen/shared";
import type {
  ExportIntent,
  ExportValue,
  InitiateExportPort,
} from "../ports/in/initiate-export.port.js";
import type { GenerateProjectUseCase } from "../generate-project-use-case.js";
import type { ExportConfig } from "../ports/out/project-exporter.port.js";

/**
 * Factory function that returns a fully-wired GenerateProjectUseCase for the
 * given destination. Injected so the use case stays adapter-agnostic.
 */
export type GenerateProjectUseCaseFactory = (
  destination: "archive" | "github",
) => GenerateProjectUseCase;

/**
 * Orchestrates a decoupled export. Unlike the legacy /api/generate flow
 * (which couples generation and export in a single wizard submission),
 * this use case can be triggered at any time from the unified workspace
 * menu or post-wizard summary.
 *
 * Delegates physical file writing + push/zip to GenerateProjectUseCase,
 * keeping adapter composition at the factory boundary.
 */
export class InitiateExportUseCase implements InitiateExportPort {
  constructor(private readonly generatorFactory: GenerateProjectUseCaseFactory) {}

  async validateReadiness(intent: ExportIntent): Promise<Result<true, Error>> {
    if (!intent.workspaceRef?.manifest) {
      return {
        success: false,
        error: new Error("Export intent missing workspace reference or manifest"),
      };
    }

    if (intent.target === "github") {
      if (!intent.repoConfig) {
        return {
          success: false,
          error: new Error("GitHub export requires repo configuration"),
        };
      }
      if (!intent.repoConfig.repoName?.trim()) {
        return {
          success: false,
          error: new Error("Repository name is required for GitHub export"),
        };
      }
      if (!intent.repoConfig.owner?.trim()) {
        return {
          success: false,
          error: new Error("Repository owner is required for GitHub export"),
        };
      }
      if (!intent.repoConfig.token?.trim()) {
        return {
          success: false,
          error: new Error("Access token is required for GitHub export"),
        };
      }
    }

    return { success: true, value: true };
  }

  async initiateExport(intent: ExportIntent): Promise<Result<ExportValue, Error>> {
    const readiness = await this.validateReadiness(intent);
    if (!readiness.success) {
      return readiness;
    }

    const destination: "archive" | "github" =
      intent.target === "zip" ? "archive" : "github";

    const exportConfig: ExportConfig = { destination };
    if (intent.target === "github" && intent.repoConfig) {
      exportConfig.github = intent.repoConfig;
    }

    try {
      const useCase = this.generatorFactory(destination);
      const result = await useCase.execute({
        manifest: intent.workspaceRef.manifest,
        exportConfig,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      if (intent.target === "zip") {
        if (!result.value.zipBuffer) {
          return {
            success: false,
            error: new Error("ZIP generation produced no buffer"),
          };
        }
        return {
          success: true,
          value: {
            zip: result.value.zipBuffer,
            filename: `${result.value.project.rootName}.zip`,
          },
        };
      }

      return {
        success: true,
        value: {
          success: true,
          destinationUrl: result.value.destinationUrl,
        },
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }
}
