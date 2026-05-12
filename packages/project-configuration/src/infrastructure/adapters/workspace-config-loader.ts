import path from "node:path";
import fs from "node:fs/promises";
import { realpathSync, lstatSync } from "node:fs";
import yaml from "js-yaml";
import { WorkspaceConfigSchema } from "../../domain/model/workspace-config/workspace-config.schema.js";
import type { WorkspaceConfig } from "../../domain/model/workspace-config/workspace-config.schema.js";

function assertPathWithinWorkspace(
  workspaceRoot: string,
  configPath: string,
): void {
  const resolved = path.resolve(workspaceRoot, configPath);
  const rootResolved = path.resolve(workspaceRoot);

  try {
    const realResolved = realpathSync(resolved);
    const realRoot = realpathSync(rootResolved);
    const rootWithSep = realRoot + path.sep;

    if (realResolved !== realRoot && !realResolved.startsWith(rootWithSep)) {
      throw new Error(`Config path escapes workspace root: "${configPath}"`);
    }
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      let checkPath = rootResolved;
      const pathSegments = path
        .relative(rootResolved, resolved)
        .split(path.sep);

      for (const segment of pathSegments) {
        checkPath = path.join(checkPath, segment);
        try {
          const stat = lstatSync(checkPath);
          if (stat.isSymbolicLink()) {
            throw new Error(
              `Config path contains a symbolic link: "${configPath}"`,
            );
          }
        } catch (statErr) {
          if (
            statErr instanceof Error &&
            "code" in statErr &&
            statErr.code === "ENOENT"
          ) {
            break;
          }
          throw statErr;
        }
      }

      const rootWithSep = rootResolved + path.sep;
      if (resolved !== rootResolved && !resolved.startsWith(rootWithSep)) {
        throw new Error(`Config path escapes workspace root: "${configPath}"`);
      }
    } else {
      throw err;
    }
  }
}

export async function loadWorkspaceConfig(
  workspaceRoot: string,
  configPath: string,
): Promise<WorkspaceConfig> {
  assertPathWithinWorkspace(workspaceRoot, configPath);
  const resolvedPath = path.resolve(workspaceRoot, configPath);
  const content = await fs.readFile(resolvedPath, "utf-8");
  const parsed = yaml.load(content);
  const result = WorkspaceConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Workspace config validation failed: ${result.error.message}`,
    );
  }
  return result.data;
}
