import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ok, err, type Result } from "@hexagen/shared";
import type { ProjectSpecLike } from "@hexagen/prompt-compiler";
import type { LinterReport } from "@hexagen/governance";
import type {
  ArchitectureGraphProviderPort,
  LinterReportProviderPort,
} from "@hexagen/sync";
import { type ArchitectureGraph } from "@hexagen/visualization";
import { ManifestSchema } from "@hexagen/project-configuration";

interface ManifestYaml {
  boundedContexts?: Array<{ name: string }>;
}

export class ManifestProviderAdapter {
  async getManifest(): Promise<ProjectSpecLike> {
    try {
      const manifestPath = path.join(
        process.cwd(),
        ".architecture/manifest.yaml",
      );
      const content = await fs.readFile(manifestPath, "utf-8");

      if (!content.trim()) {
        return { boundedContexts: [] };
      }

      const parsed = yaml.load(content) as ManifestYaml;
      const validationResult = ManifestSchema.safeParse(parsed);
      if (!validationResult.success) {
        return { boundedContexts: [] };
      }

      const validated = validationResult.data as ManifestYaml;
      return {
        boundedContexts:
          validated.boundedContexts?.map((ctx) => ({
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
    void _projectId; // satisfy no-unused-vars with underscore prefix
    try {
      const manifestPath = path.join(
        process.cwd(),
        ".architecture/manifest.yaml",
      );
      const content = await fs.readFile(manifestPath, "utf-8");
      const parsed = yaml.load(content) as ManifestYaml;

      const nodes =
        parsed.boundedContexts?.map((ctx) => ({
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
