import path from "node:path";
import fs from "node:fs/promises";
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
  const archRoot = path.resolve(workspaceRoot, ".architecture") + path.sep;
  if (!resolved.startsWith(archRoot)) {
    throw new Error(
      `Path traversal detected: "${relativePath}" resolves outside .architecture/`,
    );
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
