import type { Manifest } from "@hexagen/sync";
import type { Project } from "../../../domain/entities/project.js";
import type { Result } from "@hexagen/shared";

export interface GeneratorError {
  code: "GENERATION_FAILED" | "MANIFEST_INVALID" | "FS_ERROR";
  message: string;
  cause?: unknown;
}

export interface ExternalProjectGeneratorPort {
  generateAt(
    targetRoot: string,
    manifest: Manifest,
  ): Promise<Result<Project, GeneratorError>>;
}
