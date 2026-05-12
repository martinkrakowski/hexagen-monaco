import fs from "node:fs/promises";
import yaml from "js-yaml";
import { WorkspaceConfigSchema } from "../../domain/model/workspace-config/workspace-config.schema.js";
import type { WorkspaceConfig } from "../../domain/model/workspace-config/workspace-config.schema.js";

export async function loadWorkspaceConfig(
  workspaceRoot: string,
  configPath: string,
): Promise<WorkspaceConfig> {
  const content = await fs.readFile(configPath, "utf-8");
  const parsed = yaml.load(content);
  const result = WorkspaceConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Workspace config validation failed: ${result.error.message}`,
    );
  }
  return result.data;
}
