import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { SyncFlags } from "./config.js";
import type { Manifest } from "./types/manifest.js";
import { ManifestSchema } from "@hexagen/project-configuration";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export { __dirname };

export interface InitOptions {
  targetRoot?: string;
  manifest?: Manifest;
}

export async function findWorkspaceRoot(options: InitOptions): Promise<string> {
  if (options.targetRoot) {
    return options.targetRoot;
  }

  let currentDir = __dirname;
  while (currentDir !== path.parse(currentDir).root) {
    try {
      const pkgPath = path.join(currentDir, "package.json");
      const pkgContent = await fs.readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(pkgContent) as { workspaces?: unknown[] };
      if (pkg.workspaces && Array.isArray(pkg.workspaces)) {
        return currentDir;
      }
    } catch {
      // silent — not this directory
    }
    currentDir = path.dirname(currentDir);
  }
  throw new Error(
    'Could not locate monorepo root. No package.json with "workspaces" field found.',
  );
}

export async function loadManifest(
  workspaceRoot: string,
  flags: SyncFlags,
  options: InitOptions,
): Promise<Manifest> {
  if (options.manifest) {
    return options.manifest;
  }

  const { logger, dryRun } = flags;
  const manifestPath = path.join(workspaceRoot, ".architecture/manifest.yaml");
  logger.debug(`[debug] __dirname (ESM): ${__dirname}`);
  logger.debug(`[debug] resolved workspaceRoot: ${workspaceRoot}`);
  logger.debug(`[debug] resolved manifestPath: ${manifestPath}`);

  try {
    await fs.access(manifestPath);
    logger.debug("[debug] fs.access succeeded");
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      err.code === "ENOENT" &&
      dryRun
    ) {
      logger.warn(`Manifest not found — using empty for dry-run`);
      return { bounded_contexts: [] };
    }
    throw err;
  }

  try {
    const content = await fs.readFile(manifestPath, "utf8");
    const loaded = yaml.load(content);
    logger.info(`Loaded manifest from ${manifestPath}`);
    return (loaded as Manifest) ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown parse error";
    throw new Error(`Failed to parse manifest: ${message}`);
  }
}

export function validateManifest(manifest: Manifest, flags: SyncFlags): void {
  const { logger } = flags;
  const contexts = manifest.bounded_contexts ?? [];

  const names = contexts.map((c) => c.name).filter(Boolean);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);

  if (duplicates.length > 0) {
    throw new Error(
      `Invalid manifest: duplicate bounded context names: ${duplicates.join(", ")}`,
    );
  }

  for (const ctx of contexts) {
    if (!ctx?.name) {
      logger.warn("Skipping bounded context with missing name");
      continue;
    }
    if (!ctx?.type) {
      logger.warn(`Bounded context "${ctx.name}" missing type field`);
    }
  }

  try {
    ManifestSchema.parse(manifest);
    logger.debug("[Manifest] Zod Schema Validation passed");
  } catch (err) {
    if (err instanceof Error) {
      logger.error(`[Manifest] Schema Validation failed: ${err.message}`);
      throw new Error(`Invalid manifest structure according to schema.`);
    }
  }

  logger.debug("[Manifest] Validation passed");
}
