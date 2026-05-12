import path from "node:path";
import { ok, err, type Result } from "@hexagen/shared";
import type { Manifest } from "../../domain/model/manifest-schema/manifest-schema";
import type { ProjectConfigurationReadPort } from "../ports/out/project-configuration-read.port";
import { mergeSplitManifest } from "../../infrastructure/adapters/manifest-merge-loader.js";

export class ReadManifestUseCase implements ProjectConfigurationReadPort {
  async execute(): Promise<Result<Manifest>> {
    return this.getManifest();
  }

  async getManifest(): Promise<Result<Manifest>> {
    try {
      const manifestPath = path.join(
        process.cwd(),
        ".architecture/manifest.yaml",
      );
      const manifest = await mergeSplitManifest(process.cwd(), manifestPath);
      return ok(manifest);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return err(new Error(".architecture/manifest.yaml not found"));
      }
      return err(error as Error);
    }
  }
}
