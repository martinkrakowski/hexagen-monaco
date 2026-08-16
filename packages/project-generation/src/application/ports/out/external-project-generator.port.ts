import type { GenerationManifest } from "../../generation-manifest.js";
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
    manifest: GenerationManifest,
  ): Promise<Result<Project, GeneratorError>>;
}
