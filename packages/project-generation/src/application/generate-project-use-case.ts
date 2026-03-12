import type { ExternalProjectGeneratorPort } from "./ports/out/external-project-generator.port.js";
import type { ZipCreatorPort } from "./ports/out/zip-creator.port.js";
import type { Project } from "../domain/entities/project.js";
import type { Manifest } from "@hexagen/sync";
import type { Result } from "@hexagen/shared";

export interface GenerateProjectInput {
  targetRoot: string;
  manifest: Manifest;
  outputFormat: "files" | "zip";
}

export interface GenerateProjectOutput {
  project: Project;
  zipBuffer?: Buffer;
}

export class GenerateProjectUseCase {
  constructor(
    private readonly generator: ExternalProjectGeneratorPort,
    private readonly zipCreator: ZipCreatorPort,
  ) {}

  async execute(
    input: GenerateProjectInput,
  ): Promise<Result<GenerateProjectOutput, Error>> {
    const genResult = await this.generator.generateAt(
      input.targetRoot,
      input.manifest,
    );

    if (!genResult.success) {
      return {
        success: false,
        error: new Error(genResult.error.message),
      };
    }

    const project = genResult.value;

    let zipBuffer: Buffer | undefined;
    if (input.outputFormat === "zip") {
      const zipResult = await this.zipCreator.createZip(project);
      if (!zipResult.success) {
        return { success: false, error: new Error(zipResult.error.message) };
      }
      zipBuffer = zipResult.value;
    }

    return {
      success: true,
      value: { project, zipBuffer },
    };
  }
}
