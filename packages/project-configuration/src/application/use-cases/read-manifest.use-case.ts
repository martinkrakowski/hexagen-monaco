import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ok, err, type Result } from "@hexagen/shared";
import type { Manifest } from "../../domain/model/manifest-schema/manifest-schema";
import { ManifestSchema } from "../../domain/model/manifest-schema/manifest-schema";
import type { ProjectConfigurationReadPort } from "../ports/out/project-configuration-read.port";

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
      const content = await fs.readFile(manifestPath, "utf-8");

      if (!content.trim()) {
        return err(new Error("manifest.yaml is empty"));
      }

      const parsed = yaml.load(content);
      // Validate against Zod schema
      const validationResult = ManifestSchema.safeParse(parsed);
      if (!validationResult.success) {
        return err(
          new Error(
            `Manifest validation failed: ${validationResult.error.message}`,
          ),
        );
      }
      // Return validated manifest
      return ok(validationResult.data);
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
