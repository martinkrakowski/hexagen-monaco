import type { Manifest, Result } from "@hexagen/shared";
import type { ProjectConfigurationReadPort } from "../../application/ports/out/project-configuration-read.port.js";
import { readManifestDocument } from "./manifest-io.js";

export class ProjectConfigurationReadAdapter implements ProjectConfigurationReadPort {
  constructor(private readonly workspaceRoot: string) {}

  async getManifest(): Promise<Result<Manifest>> {
    try {
      const manifest = await readManifestDocument(this.workspaceRoot);
      return {
        success: true,
        value: manifest as Manifest,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
