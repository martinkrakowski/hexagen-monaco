import path from "node:path";
import { ok, err, type Result } from "@hexagen/shared";
import type { ProjectSpecLike } from "@hexagen/prompt-compiler";
import type { LinterReport } from "@hexagen/governance";
import { mergeSplitManifest } from "@hexagen/project-configuration/server";
import type {
  ArchitectureGraphProviderPort,
  LinterReportProviderPort,
} from "@hexagen/sync";
import type {
  Manifest,
  ManifestBoundedContext,
} from "@hexagen/project-configuration";
import { type ArchitectureGraph } from "@hexagen/visualization";
import { findMonorepoRoot } from "../monorepo-root";
import { logger } from "../../../lib/structured-logger";

/**
 * The workspace's merged manifest, read once and in one place.
 *
 * The three adapters below all need the same document and used to spell the
 * same three steps out each: anchor on the monorepo root (AUD-002 —
 * `process.cwd()` is `apps/web` under the standalone build, so the read would
 * miss and every caller would silently degrade), join `.architecture/manifest
 * .yaml`, merge the split contexts. Three copies of an anchor is how the
 * AUD-002 fix drifts; one is how it does not.
 *
 * Deliberately NOT memoized: `/api/architecture/modify/accept` rewrites this
 * file at runtime, so a process-lifetime cache here would serve a stale
 * manifest with no invalidation signal to hang a refresh on.
 *
 * Throws whatever the anchor or the loader throws — each caller below keeps its
 * own degradation posture for that failure.
 */
async function readMergedManifest(): Promise<Manifest> {
  const workspaceRoot = findMonorepoRoot();
  const manifestPath = path.join(workspaceRoot, ".architecture/manifest.yaml");
  return mergeSplitManifest(workspaceRoot, manifestPath);
}

export class ManifestProviderAdapter {
  async getManifest(): Promise<ProjectSpecLike> {
    try {
      const manifest = await readMergedManifest();

      return {
        boundedContexts:
          manifest.bounded_contexts?.map((ctx: ManifestBoundedContext) => ({
            id: ctx.name,
            name: ctx.name,
          })) || [],
      };
    } catch {
      return { boundedContexts: [] };
    }
  }
}

/**
 * Reads the workspace's merged manifest DOCUMENT (HEX-034).
 *
 * `ManifestProviderAdapter` above deliberately projects the manifest down to
 * `ProjectSpecLike` (ids + names) for the prompt-compiler seam. Consumers that
 * need the manifest's own shape — the LLM governance-context route projects
 * port ownership out of `layers.application.ports` — were reaching for
 * `mergeSplitManifest` themselves, each with its own workspace-root walk. This
 * adapter is the one place that read happens for them.
 *
 * Returns `null` rather than throwing when the manifest cannot be located or
 * merged: an absent/ill-formed manifest is a degraded-but-serviceable state for
 * read-only display consumers, exactly as it was when they caught it inline.
 */
export class ServerMergedManifestProviderAdapter {
  async getMergedManifest(): Promise<Manifest | null> {
    try {
      return await readMergedManifest();
    } catch (error) {
      // The `null` contract stays — but it must not be silent. The consumer
      // turns `null` into an empty 200, so without this an unsupported schema
      // version, a missing context file, a missing workspace-config side-car, a
      // validation failure and a `MonorepoRootNotFoundError` all present to an
      // operator as an empty governance panel and nothing else.
      logger.warn("Merged manifest read failed; serving empty context", {
        error,
      });
      return null;
    }
  }
}

export class ServerArchitectureGraphProviderAdapter implements ArchitectureGraphProviderPort {
  async getArchitectureGraph(
    _projectId: string,
  ): Promise<Result<ArchitectureGraph>> {
    void _projectId;
    try {
      const manifest = await readMergedManifest();

      const nodes =
        manifest.bounded_contexts?.map((ctx: ManifestBoundedContext) => ({
          id: ctx.name,
          label: ctx.name,
          type: "core" as const,
          status: "active" as const,
        })) || [];

      return ok({ nodes, edges: [] } as ArchitectureGraph);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export class ServerLinterReportProviderAdapter implements LinterReportProviderPort {
  async getLinterReport(): Promise<Result<LinterReport>> {
    return ok({
      timestamp: new Date().toISOString(),
      isCompliant: true,
      violations: [],
      scannedFilesCount: 0,
    });
  }
}
