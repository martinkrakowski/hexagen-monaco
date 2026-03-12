import type { Project } from "../../../domain/entities/project.js";
import type { Result } from "@hexagen/shared";

export interface ZipCreatorError {
  code: "ZIP_CREATION_FAILED";
  message: string;
  cause?: unknown;
}

export interface ZipCreatorPort {
  createZip(project: Project): Promise<Result<Buffer, ZipCreatorError>>;
}
