import path from "node:path";
import fs from "node:fs/promises";
import { realpathSync, lstatSync } from "node:fs";
import yaml from "js-yaml";
import {
  ManifestSchema,
  IndexManifestSchema,
  BoundedContextSchema,
  AppSchema,
} from "../../domain/model/manifest-schema/manifest-schema.js";
import type {
  Manifest,
  ManifestBoundedContext,
  IndexManifest,
  IndexBoundedContextEntry,
  App,
} from "../../domain/model/manifest-schema/manifest-schema.js";
import { isIndexManifest } from "../../domain/model/manifest-schema/index.js";

export { isIndexManifest };

function assertPathWithinArchitecture(
  workspaceRoot: string,
  relativePath: string,
): void {
  const resolved = path.resolve(workspaceRoot, ".architecture", relativePath);
  const archRoot = path.resolve(workspaceRoot, ".architecture");

  // Try canonical path resolution if the file exists
  try {
    const realResolved = realpathSync(resolved);
    const realArchRoot = realpathSync(archRoot);
    const archRootWithSep = realArchRoot + path.sep;

    if (
      realResolved !== realArchRoot &&
      !realResolved.startsWith(archRootWithSep)
    ) {
      throw new Error(
        `Path traversal detected: "${relativePath}" resolves outside .architecture/`,
      );
    }
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      // File doesn't exist yet - check for symlinks in parent paths
      let checkPath = archRoot;
      const pathSegments = path.relative(archRoot, resolved).split(path.sep);

      for (const segment of pathSegments) {
        checkPath = path.join(checkPath, segment);
        try {
          const stat = lstatSync(checkPath);
          if (stat.isSymbolicLink()) {
            throw new Error(
              `Path traversal detected: "${relativePath}" contains a symbolic link`,
            );
          }
        } catch (statErr) {
          if (
            statErr instanceof Error &&
            "code" in statErr &&
            statErr.code === "ENOENT"
          ) {
            // This path segment doesn't exist yet, which is fine
            break;
          }
          // Re-throw our traversal error
          if (
            statErr instanceof Error &&
            statErr.message.includes("Path traversal")
          ) {
            throw statErr;
          }
          // Re-throw other errors (permissions issues, etc.)
          throw statErr;
        }
      }

      // Lexically verify the resolved path is within archRoot
      const archRootWithSep = archRoot + path.sep;
      if (resolved !== archRoot && !resolved.startsWith(archRootWithSep)) {
        throw new Error(
          `Path traversal detected: "${relativePath}" resolves outside .architecture/`,
        );
      }
    } else {
      // Re-throw unexpected errors
      throw err;
    }
  }
}

export async function mergeSplitManifest(
  workspaceRoot: string,
  manifestPath: string,
): Promise<Manifest> {
  const content = await fs.readFile(manifestPath, "utf-8");
  const parsed = yaml.load(content);

  if (parsed == null) {
    throw new Error("Manifest file is empty");
  }

  if (!isIndexManifest(parsed)) {
    const validated = ManifestSchema.parse(parsed);
    return validated as Manifest;
  }

  const indexResult = IndexManifestSchema.safeParse(parsed);
  if (!indexResult.success) {
    throw new Error(
      `Index manifest validation failed: ${indexResult.error.message}`,
    );
  }

  const index = indexResult.data as IndexManifest;
  const result: Manifest = {
    system: index.system,
    scope: index.scope,
    architecture: index.architecture as Manifest["architecture"],
    bounded_contexts: [],
    apps: [],
  };

  const indexContexts = index.bounded_contexts ?? [];
  for (const entry of indexContexts) {
    const indexEntry = entry as IndexBoundedContextEntry;
    if (typeof indexEntry.file !== "string") {
      continue;
    }

    assertPathWithinArchitecture(workspaceRoot, indexEntry.file);

    const contextFilePath = path.join(
      workspaceRoot,
      ".architecture",
      indexEntry.file,
    );

    let contextContent: string;
    try {
      contextContent = await fs.readFile(contextFilePath, "utf-8");
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        throw new Error(`Context file not found: ${contextFilePath}`);
      }
      throw err;
    }

    const contextParsed = yaml.load(contextContent);
    const contextResult = BoundedContextSchema.safeParse(contextParsed);

    if (!contextResult.success) {
      throw new Error(
        `Bounded context "${indexEntry.name}" validation failed: ${contextResult.error.message}`,
      );
    }

    const context = contextResult.data as ManifestBoundedContext;
    if (indexEntry.plane !== undefined) {
      context.plane = indexEntry.plane;
    }
    if (indexEntry.status !== undefined) {
      context.status = indexEntry.status;
    }

    result.bounded_contexts!.push(context);
  }

  const indexApps = index.apps ?? [];
  for (const appEntry of indexApps) {
    if (typeof appEntry.file !== "string") {
      const inlinedResult = AppSchema.safeParse(appEntry);
      if (!inlinedResult.success) {
        throw new Error(
          `Inline app "${appEntry.name ?? "<unnamed>"}" validation failed: ${inlinedResult.error.message}`,
        );
      }
      result.apps!.push(inlinedResult.data as App);
      continue;
    }

    assertPathWithinArchitecture(workspaceRoot, appEntry.file);

    const appFilePath = path.join(
      workspaceRoot,
      ".architecture",
      appEntry.file,
    );

    let appContent: string;
    try {
      appContent = await fs.readFile(appFilePath, "utf-8");
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        throw new Error(`App file not found: ${appFilePath}`);
      }
      throw err;
    }

    const appParsed = yaml.load(appContent);
    const appResult = AppSchema.safeParse(appParsed);
    if (!appResult.success) {
      throw new Error(
        `App file "${appEntry.file}" validation failed: ${appResult.error.message}`,
      );
    }
    result.apps!.push(appResult.data as App);
  }

  return result;
}
