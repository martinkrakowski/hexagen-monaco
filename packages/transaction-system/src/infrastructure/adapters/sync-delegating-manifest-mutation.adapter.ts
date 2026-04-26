import { loadManifest, saveManifest } from "@hexagen/sync";
import type { Manifest, BoundedContext } from "@hexagen/sync";
import type { Patch } from "@hexagen/core-domain";
import { execSync } from "node:child_process";
import path from "node:path";
import type { ManifestMutationPort } from "../../application/ports/out/manifest-mutation.port.js";
import type { Result } from "../../application/result.js";

export class SyncDelegatingManifestMutationAdapter implements ManifestMutationPort {
  constructor(private readonly workspaceRoot: string) {}

  async applyPatches(
    patches: Patch[],
    _manifestPath: string,
  ): Promise<Result<void, Error>> {
    try {
      const loadResult = await loadManifest(this.workspaceRoot);
      if (!loadResult.success) {
        return { success: false, error: loadResult.error };
      }

      const manifest = loadResult.value as Manifest;
      const patched = this.applyPatchesToManifest(manifest, patches);

      const saveResult = await saveManifest(this.workspaceRoot, patched);
      if (!saveResult.success) {
        return { success: false, error: saveResult.error };
      }

      return { success: true, value: undefined };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }

  async restoreFromGit(manifestPath: string): Promise<Result<void, Error>> {
    try {
      const relativePath = path.relative(this.workspaceRoot, manifestPath);
      execSync(`git checkout -- ${relativePath}`, {
        cwd: this.workspaceRoot,
        stdio: "pipe",
      });
      return { success: true, value: undefined };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }

  private applyPatchesToManifest(
    manifest: Manifest,
    patches: Patch[],
  ): Manifest {
    const result = JSON.parse(JSON.stringify(manifest)) as Manifest;

    for (const patch of patches) {
      switch (patch.type) {
        case "add_node":
          this.applyAddNode(result, patch);
          break;
        case "update_node":
          this.applyUpdateNode(result, patch);
          break;
        case "remove_node":
          this.applyRemoveNode(result, patch);
          break;
        case "add_edge":
          this.applyAddEdge(result, patch);
          break;
        case "update_edge":
          this.applyUpdateEdge(result, patch);
          break;
        case "remove_edge":
          this.applyRemoveEdge(result, patch);
          break;
      }
    }

    return result;
  }

  private applyAddNode(manifest: Manifest, patch: Patch): void {
    const contexts = manifest.bounded_contexts ?? [];
    const ctxId = patch.targetId;
    
    // Check for duplicate context
    if (contexts.some((c) => c.name === ctxId)) {
      throw new Error(`Bounded context '${ctxId}' already exists`);
    }
    
    const context: BoundedContext = {
      name: ctxId,
      type: (patch.payload.kind as BoundedContext["type"]) ?? "core",
      ...patch.payload,
    };
    contexts.push(context);
    manifest.bounded_contexts = contexts;
  }

  private applyUpdateNode(manifest: Manifest, patch: Patch): void {
    const contexts = manifest.bounded_contexts ?? [];
    const idx = contexts.findIndex((c) => c.name === patch.targetId);
    if (idx >= 0) {
      contexts[idx] = { ...contexts[idx], ...patch.payload } as BoundedContext;
    }
  }

  private applyRemoveNode(manifest: Manifest, patch: Patch): void {
    manifest.bounded_contexts = (manifest.bounded_contexts ?? []).filter(
      (c) => c.name !== patch.targetId,
    );
  }

  private applyAddEdge(manifest: Manifest, patch: Patch): void {
    const source = patch.payload.source as string | undefined;
    const target = patch.payload.target as string | undefined;
    if (!source || !target) return;

    const contexts = manifest.bounded_contexts ?? [];
    const sourceCtx = contexts.find((c) => c.name === source);
    if (sourceCtx) {
      sourceCtx.depends_on = [...(sourceCtx.depends_on ?? []), target];
    }
  }

  private applyUpdateEdge(_manifest: Manifest, _patch: Patch): void {
    // Edge updates modify depends_on entries on contexts
  }

  private applyRemoveEdge(manifest: Manifest, patch: Patch): void {
    const source = patch.payload.source as string | undefined;
    const target = patch.payload.target as string | undefined;
    if (!source || !target) return;

    const contexts = manifest.bounded_contexts ?? [];
    const sourceCtx = contexts.find((c) => c.name === source);
    if (sourceCtx?.depends_on) {
      sourceCtx.depends_on = sourceCtx.depends_on.filter((d) => d !== target);
    }
  }
}
