import type { Result } from "@hexagen/shared";
import { err, ok } from "@hexagen/shared";
import type {
  GovernanceDecision,
  GovernanceInvariants,
  GovernanceReadPort,
  LinterConfigEntry,
  WorkspaceContext,
} from "../../application/ports/out/governance-read.port.js";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export class GovernanceReadAdapter implements GovernanceReadPort {
  constructor(private readonly workspaceRoot: string) {}

  async getDecisions(): Promise<Result<GovernanceDecision[]>> {
    try {
      const decisionsDir = path.join(
        this.workspaceRoot,
        ".architecture/decisions",
      );
      const entries = await fs.readdir(decisionsDir);
      const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();

      const decisions: GovernanceDecision[] = [];
      for (const filename of mdFiles) {
        const filePath = path.join(decisionsDir, filename);
        const content = await fs.readFile(filePath, "utf-8");
        const id = filename.split("-")[0];
        const h1Match = content.match(/^#\s+(.+)$/m);
        const title = h1Match ? h1Match[1] : filename;

        decisions.push({ id, title, filename, content });
      }

      return ok(decisions);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getInvariants(): Promise<Result<GovernanceInvariants>> {
    try {
      const layerRulesPath = path.join(
        this.workspaceRoot,
        ".architecture/invariants/layer-rules.yaml",
      );
      const content = await fs.readFile(layerRulesPath, "utf-8");
      const parsed = yaml.load(content) as Record<string, unknown>;

      const layers = parsed.layers as Record<
        string,
        { access_rule: string; allowed_imports: string[] }
      >;
      const layerRules = Object.entries(layers).map(([layer, rule]) => ({
        layer,
        accessRule: rule.access_rule,
        allowedImports: rule.allowed_imports,
      }));

      const crossPackageRules = (
        parsed.cross_package_rules as Array<Record<string, unknown>>
      ).map((rule) => ({
        package: rule.package as string,
        cannotImport: rule.cannot_import as string[] | undefined,
        allowedImports: rule.allowed_imports as string[] | undefined,
      }));

      return ok({ layerRules, crossPackageRules });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getLinterConfig(): Promise<Result<LinterConfigEntry[]>> {
    try {
      const configPath = path.join(
        this.workspaceRoot,
        ".architecture/invariants/linter-config.yaml",
      );
      const content = await fs.readFile(configPath, "utf-8");
      const parsed = yaml.load(content) as Record<string, unknown>;

      const packageRules = parsed.package_rules as Array<{
        name: string;
        allowed_imports: string[];
      }>;
      const entries: LinterConfigEntry[] = packageRules.map((rule) => ({
        name: rule.name,
        allowedImports: rule.allowed_imports,
      }));

      return ok(entries);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getWorkspaceContext(): Promise<Result<WorkspaceContext>> {
    try {
      const manifestPath = path.join(
        this.workspaceRoot,
        ".architecture/manifest.yaml",
      );
      const content = await fs.readFile(manifestPath, "utf-8");
      const parsed = yaml.load(content) as Record<string, unknown>;

      const architecture = parsed.architecture as string;
      const workspaceTemplate = architecture;
      const boundedContexts = parsed.bounded_contexts as unknown[];
      const apps = parsed.apps as unknown[];
      const monorepo = parsed.monorepo as {
        packageManager: string;
        buildTool: string;
      };

      return ok({
        systemName: parsed.system as string,
        scope: parsed.scope as string,
        architecture,
        workspaceTemplate,
        boundedContextCount: boundedContexts.length,
        appCount: apps.length,
        packageManager: monorepo.packageManager,
        buildTool: monorepo.buildTool,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
