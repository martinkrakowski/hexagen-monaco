import type { Result } from "@hexagen/shared";
import type { Patch, ProjectSpecLike } from "../../../domain/llm-response.js";

export interface ManifestPatchPort {
  applyPatches(
    patches: Patch[],
    manifestPath: string,
  ): Promise<Result<void, Error>>;
  validatePatches(
    patches: Patch[],
    currentManifest: ProjectSpecLike,
  ): Promise<Result<Patch[], Error>>;
}
