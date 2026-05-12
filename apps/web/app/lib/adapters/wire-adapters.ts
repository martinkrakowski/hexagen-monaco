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

export class ManifestProviderAdapter {
  async getManifest(): Promise<ProjectSpecLike> {
    try {
      const workspaceRoot = process.cwd();
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
      const workspaceRoot = process.cwd();
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
