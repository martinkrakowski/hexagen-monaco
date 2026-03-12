import type { Manifest } from "@hexagen/sync";
import type { Project } from "../../../domain/entities/project.js";

export interface ExternalProjectGeneratorPort {
  generateAt(targetRoot: string, manifest: Manifest): Promise<Project>;
}
