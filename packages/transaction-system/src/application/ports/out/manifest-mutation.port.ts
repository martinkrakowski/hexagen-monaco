import type { Patch } from "@hexagen/core-domain";
import type { Result } from "../../result.js";

/**
 * The `manifestPath` argument on both methods must be within the adapter's
 * workspace root. The concrete `Sync…` adapter treats the workspace root as the
 * single anchor (it re-derives load/save from it and resolves git restore
 * relative to it), so callers must resolve `manifestPath` against that root.
 */
export interface ManifestMutationPort {
  applyPatches(
    patches: Patch[],
    manifestPath: string,
  ): Promise<Result<void, Error>>;
  restoreFromGit(manifestPath: string): Promise<Result<void, Error>>;
}
