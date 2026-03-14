import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "fs";
import { join, dirname } from "path";
import yaml from "js-yaml";
import type { Manifest } from "@hexagen/sync";
import type { BoundedContext } from "../../../types/manifest.js";

export interface SaveResult {
  success: boolean;
  error?: Error;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

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

function getManifestPath(cwd: string): string {
  return join(cwd, ".architecture", "manifest.yaml");
}

export function loadManifest(
  cwd: string,
): { success: true; data: Manifest } | { success: false; error: Error } {
  try {
    const manifestPath = getManifestPath(cwd);
    const content = readFileSync(manifestPath, "utf-8");
    const manifest = yaml.load(content) as Manifest;

    if (!manifest || typeof manifest !== "object") {
      return { success: false, error: new Error("Invalid manifest structure") };
    }

    return { success: true, data: manifest };
  } catch (err) {
    const error = err as Error;
    return { success: false, error };
  }
}

export function addContextToManifest(
  manifest: Manifest,
  name: string,
  type: "core" | "supporting" | "shared-kernel" | "driver" = "core",
  description?: string,
): Manifest {
  const newContext: BoundedContext = {
    name,
    type,
    ...(description && { description }),
  };

  return {
    ...manifest,
    bounded_contexts: [...(manifest.bounded_contexts || []), newContext],
  };
}

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

export function saveManifest(cwd: string, manifest: Manifest): SaveResult {
  const manifestPath = getManifestPath(cwd);
  const tempPath = `${manifestPath}.tmp`;

  try {
    ensureDirectoryExists(dirname(manifestPath));
    const yamlContent = generateManifestYaml(manifest);
    writeFileSync(tempPath, yamlContent, "utf-8");
    renameSync(tempPath, manifestPath);

    return { success: true };
  } catch (err) {
    const fsError = err as Error;

    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      error: new Error(`Failed to save manifest: ${fsError.message}`),
    };
  }
}

export function validateContextName(name: string): ValidationResult {
  const errors: string[] = [];

  // snake_case format
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    errors.push("Must be lowercase snake_case (e.g., 'user-management')");
  }

  // Reserved names
  const reserved = ["shared", "core", "root", "system"];
  if (reserved.includes(name.toLowerCase())) {
    errors.push(`Cannot use reserved name '${name}'`);
  }

  // Length check
  if (name.length < 3) {
    errors.push("Name must be at least 3 characters");
  }

  if (name.length > 50) {
    errors.push("Name must be less than 50 characters");
  }

  return { valid: errors.length === 0, errors };
}

export function checkContextUniqueness(
  name: string,
  manifest: Manifest,
): ValidationResult {
  const exists = manifest.bounded_contexts?.some((ctx) => ctx.name === name);

  if (exists) {
    return {
      valid: false,
      errors: [`Context '${name}' already exists`],
    };
  }

  return { valid: true, errors: [] };
}
