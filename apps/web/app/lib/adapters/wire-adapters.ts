import path from "node:path";
import { ok, err, type Result } from "@hexagen/shared";
import type { ProjectSpecLike } from "@hexagen/prompt-compiler";
import type { LinterReport } from "@hexagen/governance";
import { mergeSplitManifest } from "@hexagen/project-configuration/server";
import type {
  ArchitectureGraphProviderPort,
  LinterReportProviderPort,
} from "@hexagen/sync";
import type { ManifestBoundedContext } from "@hexagen/project-configuration";
import { type ArchitectureGraph } from "@hexagen/visualization";
import { findMonorepoRoot } from "../monorepo-root";

export class ManifestProviderAdapter {
  async getManifest(): Promise<ProjectSpecLike> {
    try {
      // Anchor on the monorepo root, not process.cwd() (which is apps/web under
      // the standalone build) — otherwise the manifest read fails and the catch
      // below silently degrades this provider to an empty context list.
      const workspaceRoot = findMonorepoRoot();
      const manifestPath = path.join(
        workspaceRoot,
        ".architecture/manifest.yaml",
      );
      const manifest = await mergeSplitManifest(workspaceRoot, manifestPath);

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

export class ServerArchitectureGraphProviderAdapter implements ArchitectureGraphProviderPort {
  async getArchitectureGraph(
    _projectId: string,
  ): Promise<Result<ArchitectureGraph>> {
    void _projectId;
    try {
      // Same monorepo-root anchor as ManifestProviderAdapter — process.cwd()
      // would resolve the wrong directory under the standalone build and the
      // catch below would return an empty graph instead of the real one.
      const workspaceRoot = findMonorepoRoot();
      const manifestPath = path.join(
        workspaceRoot,
        ".architecture/manifest.yaml",
      );
      const manifest = await mergeSplitManifest(workspaceRoot, manifestPath);

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
