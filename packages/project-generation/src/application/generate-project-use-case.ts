import type { ExternalProjectGeneratorPort } from "./ports/out/external-project-generator.port.js";
import type {
  ExportConfig,
  ProjectExporterPort,
} from "./ports/out/project-exporter.port.js";
import type { Project } from "../domain/entities/project.js";
import type { Manifest } from "@hexagen/sync";
import type { Result } from "@hexagen/shared";
import fs from "node:fs/promises";
import path from "node:path";

export interface GenerateProjectInput {
  manifest: Manifest;
  exportConfig: ExportConfig;
}

export interface GenerateProjectOutput {
  project: Project;
  destinationUrl: string;
  zipBuffer?: Buffer;
}

export class GenerateProjectUseCase {
  constructor(
    private readonly generator: ExternalProjectGeneratorPort,
    private readonly exporter: ProjectExporterPort,
  ) {}

  async execute(
    input: GenerateProjectInput,
  ): Promise<Result<GenerateProjectOutput, Error>> {
    const tempDir = path.join(
      "/tmp",
      `hexagen-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    );

    try {
      const genResult = await this.generator.generateAt(
        tempDir,
        input.manifest,
      );

      if (!genResult.success) {
        return {
          success: false,
          error: new Error(genResult.error.message),
        };
      }

      const project = genResult.value;

      const exportResult = await this.exporter.export(
        tempDir,
        input.exportConfig,
      );

      if (!exportResult.success) {
        return {
          success: false,
          error: new Error(exportResult.error ?? "Export failed"),
        };
      }

      let zipBuffer: Buffer | undefined;
      if (input.exportConfig.destination === "archive") {
        try {
          const zipPath = path.join(tempDir, "project.zip");
          const zipContent = await fs.readFile(zipPath);
          zipBuffer = zipContent;
        } catch {
          // Archive export might not create a zip file if streaming directly
        }
      }

      return {
        success: true,
        value: {
          project,
          destinationUrl: exportResult.destinationUrl,
          zipBuffer,
        },
      };
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }
}
