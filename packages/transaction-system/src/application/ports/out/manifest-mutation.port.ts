import type { Patch } from "@hexagen/core-domain";
import type { Result } from "../../result.js";

export interface ManifestMutationPort {
  applyPatches(
    patches: Patch[],
    manifestPath: string,
  ): Promise<Result<void, Error>>;
  restoreFromGit(manifestPath: string): Promise<Result<void, Error>>;
}
