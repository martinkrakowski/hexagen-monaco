import type { Result } from "@hexagen/shared";
import { ok, err } from "@hexagen/shared";
import type {
  Patch,
  ProjectSpecLike,
} from "../../domain/llm-response.js";
import type { ManifestPatchPort } from "../../application/ports/out/manifest-patch.port.js";

export class ManifestPatchAdapter implements ManifestPatchPort {
  async applyPatches(
    _patches: Patch[],
    _manifestPath: string,
  ): Promise<Result<void, Error>> {
    try {
      // Patches are applied by the transaction-system layer
      // This adapter provides a no-op success response
      return ok(undefined) as Result<void, Error>;
    } catch (error) {
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      return err(errorInstance) as Result<void, Error>;
    }
  }

  async validatePatches(
    patches: Patch[],
    _currentManifest: ProjectSpecLike,
  ): Promise<Result<Patch[], Error>> {
    try {
      // Check for duplicate add_node patches with same targetId
      const addNodePatchesByTargetId = new Map<string, Patch>();

      for (const patch of patches) {
        if (patch.type === "add_node") {
          if (addNodePatchesByTargetId.has(patch.targetId)) {
            const error = new Error(
              `Duplicate add_node patch detected for targetId: ${patch.targetId}`,
            );
            return err(error) as Result<Patch[], Error>;
          }
          addNodePatchesByTargetId.set(patch.targetId, patch);
        }
      }

      // All validations passed
      return ok(patches) as Result<Patch[], Error>;
    } catch (error) {
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      return err(errorInstance) as Result<Patch[], Error>;
    }
  }
}
