import { ok, err, type Result } from "@hexagen/shared";
import type { Manifest } from "../../domain/model/manifest-schema/manifest-schema";
import type { ProjectConfigurationReadPort } from "../ports/out/project-configuration-read.port";
import type { FileSystemPort } from "../ports/out/file-system.port.js";

export class ReadManifestUseCase implements ProjectConfigurationReadPort {
  private fileSystem: FileSystemPort;

  constructor(fileSystem: FileSystemPort) {
    this.fileSystem = fileSystem;
  }

  async execute(): Promise<Result<Manifest>> {
    return this.getManifest();
  }

  async getManifest(): Promise<Result<Manifest>> {
    try {
      const manifestPath = `${process.cwd()}/.architecture/manifest.yaml`;
      const manifestStr = await this.fileSystem.mergeManifests(process.cwd(), manifestPath);
      const manifest = JSON.parse(manifestStr) as Manifest;
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
