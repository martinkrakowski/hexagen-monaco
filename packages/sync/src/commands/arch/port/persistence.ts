import { writeFileSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import yaml from "js-yaml";
import type { Manifest } from "@hexagen/sync";

/**
 * SaveResult — typed result wrapper for manifest persistence operations.
 * Follows Result<T,E> pattern per AGENTS.md §8 Testing Protocol conventions.
 */
export interface SaveResult {
  success: boolean;
  error?: Error;
}

/**
 * Ensures the directory structure exists before writing files.
 * Creates parent directories as needed (mkdir -p equivalent).
 */
function ensureDirectoryExists(dirPath: string): void {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (err) {
    const fsError = err as Error;
    throw new Error(
      `Failed to create directory '${dirPath}': ${fsError.message}`,
    );
  }
}

/**
 * Resolves the manifest.yaml path within a given working directory.
 */
function getManifestPath(cwd: string): string {
  return join(cwd, ".architecture", "manifest.yaml");
}

/**
 * Persists an updated manifest to disk atomically.
 *
 * Atomic write pattern:
 * 1. Ensure target directory exists
 * 2. Write to temporary file (with .tmp extension)
 * 3. Rename temp file to final name (atomic on POSIX systems)
 * 4. Rollback on failure
 *
 * Per AGENTS.md §8 Testing Protocol: All fallible operations return Result type.
 */
export function saveManifest(cwd: string, manifest: Manifest): SaveResult {
  const manifestPath = getManifestPath(cwd);
  const tempPath = `${manifestPath}.tmp`;

  try {
    // Step 1: Ensure directory exists
    ensureDirectoryExists(dirname(manifestPath));

    // Step 2: Serialize manifest to YAML string using template formatting
    const yamlContent = generateManifestYaml(manifest);

    // Step 3: Write to temporary file first
    writeFileSync(tempPath, yamlContent, "utf-8");

    // Step 3: Atomic rename (POSIX atomic operation)
    renameSync(tempPath, manifestPath);

    return { success: true };
  } catch (err) {
    const fsError = err as Error;

    // Clean up temporary file if it exists after failure
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors — primary error is more important
    }

    return {
      success: false,
      error: new Error(`Failed to save manifest: ${fsError.message}`),
    };
  }
}

/**
 * Generate YAML content from manifest using js-yaml.
 * Handles all fields correctly including system, scope, apps, ports.
 */
export function generateManifestYaml(manifest: Manifest): string {
  const cleanManifest = {
    system: manifest.system,
    scope: manifest.scope,
    architecture: manifest.architecture,
    bounded_contexts: manifest.bounded_contexts,
    monorepo: manifest.monorepo,
    apps: manifest.apps,
  };

  return yaml.dump(cleanManifest, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
  });
}

/**
 * Alternative async version using Node.js fs/promises API.
 * Preferred for non-blocking operations in CLI tools.
 */
import { writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname as pathDirname } from "path";

export async function saveManifestAsync(
  cwd: string,
  manifest: Manifest,
): Promise<SaveResult> {
  const manifestPath = getManifestPath(cwd);
  const tempPath = `${manifestPath}.tmp`;

  try {
    // Step 1: Ensure directory exists (async)
    await mkdir(pathDirname(manifestPath), { recursive: true });

    // Step 2: Serialize and write to temporary file
    const yamlContent = generateManifestYaml(manifest);
    await writeFile(tempPath, yamlContent, "utf-8");

    // Step 3: Atomic rename (POSIX atomic operation)
    await rename(tempPath, manifestPath);

    return { success: true };
  } catch (err) {
    const fsError = err as Error;

    // Clean up temporary file if it exists after failure
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors — primary error is more important
    }

    return {
      success: false,
      error: new Error(`Failed to save manifest: ${fsError.message}`),
    };
  }
}
