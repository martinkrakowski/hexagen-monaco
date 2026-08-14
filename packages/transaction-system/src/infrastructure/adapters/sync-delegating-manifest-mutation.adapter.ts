import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { loadManifest, saveManifest } from "@hexagen/sync";
import type { Manifest, BoundedContext } from "@hexagen/sync";
import type { Patch } from "@hexagen/core-domain";
import type { ManifestMutationPort } from "../../application/ports/out/manifest-mutation.port.js";
import type { Result } from "../../application/result.js";

const execFileAsync = promisify(execFile);

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  delayMs: number = RETRY_DELAY_MS,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

export class SyncDelegatingManifestMutationAdapter implements ManifestMutationPort {
  private readonly loadManifestFn: typeof loadManifest;
  private readonly saveManifestFn: typeof saveManifest;

  constructor(
    private readonly workspaceRoot: string,
    deps: {
      loadManifest?: typeof loadManifest;
      saveManifest?: typeof saveManifest;
    } = {},
  ) {
    this.loadManifestFn = deps?.loadManifest ?? loadManifest;
    this.saveManifestFn = deps?.saveManifest ?? saveManifest;
  }

  // Anchor invariant: `workspaceRoot` (set at construction from the monorepo
  // root) is the single source of truth for the manifest location. `applyPatches`
  // deliberately ignores the incoming path param and re-derives load/save from
  // `workspaceRoot`; `restoreFromGit` honors the param but callers MUST pass a
  // path within `workspaceRoot` (see the API routes' findMonorepoRoot anchoring).
  async applyPatches(
    patches: Patch[],
    _manifestPath: string,
  ): Promise<Result<void, Error>> {
    try {
      const loadResult = await this.loadManifestFn(this.workspaceRoot);
      if (!loadResult.success) {
        return { success: false, error: loadResult.error };
      }

      const manifest = loadResult.value as Manifest;
      const patched = this.applyPatchesToManifest(manifest, patches);

      const saveResult = await this.saveManifestFn(this.workspaceRoot, patched);
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
      await retryWithBackoff(() =>
        execFileAsync("git", ["checkout", "--", relativePath], {
          cwd: this.workspaceRoot,
          timeout: 30_000,
        }),
      );
      return { success: true, value: undefined };
    } catch (err) {
      return {
        success: false,
        error: new Error(
          `Git restore failed for ${manifestPath}: ${(err as Error).message}`,
        ),
      };
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

  private applyUpdateEdge(_manifest: Manifest, _patch: Patch): void {}

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
