/* eslint-disable no-console */
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { findWorkspaceRoot } from "../../sync-engine-init.js";
import { ManifestSchema } from "@hexagen/project-configuration";
import type { IndexManifest, PlaneType } from "@hexagen/project-configuration";
import type { App } from "../../types/manifest/apps.js";
import { buildPlaneLookup, extractContextData } from "./split-utils.js";

function flattenStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) {
    throw new TypeError(
      `Expected array for adapter list, got "${typeof val}": ${JSON.stringify(val)}`,
    );
  }
  const result: string[] = [];
  for (const item of val) {
    if (typeof item === "string") {
      result.push(item);
    } else if (Array.isArray(item)) {
      result.push(...flattenStringArray(item));
    } else {
      throw new TypeError(
        `Invalid adapter entry type "${typeof item}" in layers.infrastructure.adapters, value: ${JSON.stringify(item)}`,
      );
    }
  }
  return result;
}

function normalizeContextData(
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...ctx };
  const layers = out.layers as Record<string, unknown> | undefined;
  if (layers) {
    const infra = layers.infrastructure as Record<string, unknown> | undefined;
    if (infra && Array.isArray(infra.adapters)) {
      infra.adapters = flattenStringArray(infra.adapters);
    }
  }
  return out;
}

const RELATIONSHIP_PATTERNS: IndexManifest["relationship_patterns"] = {
  "U/D": {
    description:
      "Upstream/Downstream — the upstream team has independent power to decide what gets published; the downstream team must conform or invest in a translator.",
    acl_required: "optional",
    linter: "enforce-dependency-direction",
  },
  ACL: {
    description:
      "Anti-Corruption Layer — a translation boundary that prevents upstream model concepts from leaking into the downstream bounded context.",
    acl_required: true,
    linter: "enforce-adapter-exists",
  },
  SK: {
    description:
      "Shared Kernel — a deliberately shared subset of the domain model, maintained by mutual agreement. Must exist in the global_whitelist.",
    acl_required: false,
    linter: "enforce-global-whitelist",
  },
  P: {
    description:
      "Partnership — two teams collaborate closely with reciprocal dependency. Both sides must declare the relationship.",
    acl_required: false,
    linter: "enforce-reciprocal-declaration",
  },
  OHS: {
    description:
      "Open Host Service — the upstream publishes a well-defined protocol/API for any downstream consumer. Replaces ad-hoc integration.",
    acl_required: false,
    linter: "enforce-published-language",
  },
};

export const manifestSplitCommander = new Command("split")
  .description("Split monolithic manifest.yaml into bounded context files")
  .option("--dry-run", "Preview changes without writing files")
  .action(async (options: { dryRun?: boolean }) => {
    const dryRun = options.dryRun ?? false;

    try {
      const workspaceRoot = await findWorkspaceRoot({});
      const monolithicManifestPath = path.join(
        workspaceRoot,
        ".architecture/manifest.yaml",
      );

      console.log(
        `Reading monolithic manifest from ${monolithicManifestPath}...`,
      );

      let manifestContent: string;
      try {
        manifestContent = await fs.readFile(monolithicManifestPath, "utf-8");
      } catch {
        throw new Error(`Failed to read manifest.yaml. Does it exist?`);
      }

      const rawYaml = yaml.load(manifestContent) as Record<string, unknown>;

      console.log("Validating manifest against new strict schemas...");
      const parseResult = ManifestSchema.safeParse(rawYaml);

      if (!parseResult.success) {
        console.error(
          "\n❌ Structural violations found! The manifest cannot be safely split until these are manually fixed.",
        );
        console.error(
          "This is likely due to indentation collapses or incorrect nesting in the monolithic YAML.\n",
        );
        parseResult.error.errors.forEach((err) => {
          console.error(`- ${err.path.join(".")}: ${err.message}`);
        });
        process.exit(1);
      }

      const manifest = parseResult.data;
      const contexts = manifest.bounded_contexts ?? [];

      console.log(
        `\nValidation successful. Found ${contexts.length} bounded contexts.`,
      );

      const planes =
        (rawYaml.planes as Record<string, string[]> | undefined) ?? {};
      const planeLookup = buildPlaneLookup(planes);

      console.log("Splitting manifest into the new directory structure...");

      const archDir = path.join(workspaceRoot, ".architecture");
      const contextsDir = path.join(archDir, "contexts");
      const appsDir = path.join(archDir, "apps");
      const invariantsDir = path.join(archDir, "invariants");

      if (!dryRun) {
        await fs.mkdir(contextsDir, { recursive: true });
        await fs.mkdir(appsDir, { recursive: true });
        await fs.mkdir(invariantsDir, { recursive: true });
      }

      const CATEGORY_B_KEYS = new Set(["monorepo", "generator"]);

      const workspaceConfig: Record<string, unknown> = {};
      for (const key of CATEGORY_B_KEYS) {
        if (rawYaml[key] !== undefined) {
          workspaceConfig[key] = rawYaml[key];
        }
      }

      const indexManifest: IndexManifest = {
        version: "2.0",
        system: manifest.system,
        scope: manifest.scope,
        architecture: rawYaml.architecture as string | undefined,
        planes,
        bounded_contexts: [],
        apps: [],
        invariants: {
          layer_rules: "invariants/layer-rules.yaml",
          linter_config: "invariants/linter-config.yaml",
        },
        agent_instructions: {
          read_order: [
            "manifest.yaml",
            "workspace.config.yaml",
            "invariants/layer-rules.yaml",
            "contexts/{plane}/{target}/context.yaml",
          ],
          never_load_in_parallel: ["contexts/frozen/"],
        },
        relationship_patterns: RELATIONSHIP_PATTERNS,
        legacy_config: "generator.config.yaml",
        workspace_config: "workspace.config.yaml",
      };

      if (rawYaml.mvk !== undefined) {
        indexManifest.mvk = rawYaml.mvk as Record<string, unknown>;
      }

      for (const ctx of contexts) {
        const plane = (planeLookup.get(ctx.name) ??
          ctx.plane ??
          "core") as PlaneType;
        const ctxDir = path.join(contextsDir, plane, ctx.name);

        const contextData = normalizeContextData(
          extractContextData(ctx as unknown as Record<string, unknown>),
        );
        contextData.plane = plane;

        const ctxFilePath = path.join(ctxDir, "context.yaml");
        const ctxYaml = yaml.dump(contextData, {
          noRefs: true,
          sortKeys: false,
          lineWidth: -1,
        });

        if (dryRun) {
          console.log(`[dry-run] Would create: ${ctxFilePath}`);
        } else {
          await fs.mkdir(ctxDir, { recursive: true });
          await fs.writeFile(ctxFilePath, ctxYaml, "utf-8");
        }

        indexManifest.bounded_contexts!.push({
          name: ctx.name,
          type: ctx.type,
          plane,
          status: ctx.status || "active",
          ...(ctx.status === "frozen"
            ? { frozen_since: new Date().toISOString().split("T")[0] }
            : {}),
          file: `contexts/${plane}/${ctx.name}/context.yaml`,
        });
      }

      const apps = manifest.apps ?? [];
      for (const app of apps) {
        if (typeof app === "object" && app !== null && "name" in app) {
          const typedApp = app as App;
          const appName = typedApp.name;
          const appFilePath = path.join(appsDir, `${appName}.app.yaml`);
          const appYaml = yaml.dump(app, {
            noRefs: true,
            sortKeys: false,
            lineWidth: -1,
          });

          if (dryRun) {
            console.log(`[dry-run] Would create: ${appFilePath}`);
          } else {
            await fs.writeFile(appFilePath, appYaml, "utf-8");
          }

          indexManifest.apps!.push({
            name: appName,
            file: `apps/${appName}.app.yaml`,
          });
        }
      }

      const workspaceConfigPath = path.join(archDir, "workspace.config.yaml");
      const workspaceConfigYaml = yaml.dump(workspaceConfig, {
        noRefs: true,
        sortKeys: false,
        lineWidth: -1,
      });

      if (dryRun) {
        console.log(`[dry-run] Would create: ${workspaceConfigPath}`);
        console.log("\n--- Preview of workspace.config.yaml ---\n");
        console.log(workspaceConfigYaml);
      } else {
        await fs.writeFile(workspaceConfigPath, workspaceConfigYaml, "utf-8");
      }

      const indexYaml = yaml.dump(indexManifest, {
        noRefs: true,
        sortKeys: false,
        lineWidth: -1,
      });

      const header = `# manifest.yaml
# ─────────────────────────────────────────────────────────────────
# AGENT ENTRY POINT — load this file first, then load only the
# bounded-context files relevant to your task. Never load all
# context files simultaneously. Never edit context files not
# referenced by your current task.
# ─────────────────────────────────────────────────────────────────
`;

      if (dryRun) {
        console.log("[dry-run] Would overwrite: " + monolithicManifestPath);
        console.log("\n--- Preview of new index manifest.yaml ---\n");
        console.log(header + indexYaml);
      } else {
        const backupPath = monolithicManifestPath + ".pre-split-backup";
        await fs.copyFile(monolithicManifestPath, backupPath);
        console.log(`Backup created at ${backupPath}`);

        await fs.writeFile(monolithicManifestPath, header + indexYaml, "utf-8");
      }

      console.log("\n✅ Manifest split completed successfully!");
      if (dryRun) {
        console.log("(dry-run — no files were written)");
      }
      console.log(`Processed ${contexts.length} bounded contexts.`);
      console.log(
        `Index manifest ${dryRun ? "would be" : "created at"} .architecture/manifest.yaml`,
      );
      console.log(
        `Workspace config ${dryRun ? "would be" : "created at"} .architecture/workspace.config.yaml`,
      );
    } catch (err) {
      console.error(
        `\n❌ Fatal error during split: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });
