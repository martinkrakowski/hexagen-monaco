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
import { assertSupportedSchemaVersion } from "../../domain/model/manifest-schema/manifest-schema-version.js";
import { WorkspaceConfigSchema } from "../../domain/model/workspace-config/workspace-config.schema.js";

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

  // Version gate BEFORE any zod parse, on the RAW yaml — both schema forms
  // are `.strict()`, so a manifest written by a newer toolchain (likely
  // carrying keys this version doesn't know) would otherwise fail as
  // "unrecognized key": misdiagnosed as malformed instead of too new. The
  // ROOT manifest carries the version; context/app files inherit it. This is
  // the single seam every reader shares — the `hexagen` commands consume it
  // via @hexagen/sync's loader re-export, and the arch-linter bundles this
  // module (ADR-0068) and surfaces this message verbatim from its top-level
  // catch.
  assertSupportedSchemaVersion(parsed);

  if (!isIndexManifest(parsed)) {
    const manifestData = {
      ...parsed,
      description:
        (parsed as Manifest).description ?? "Auto-generated manifest",
    };
    const validated = ManifestSchema.parse(manifestData);
    return validated as Manifest;
  }

  const indexResult = IndexManifestSchema.safeParse(parsed);
  if (!indexResult.success) {
    throw new Error(
      `Index manifest validation failed: ${indexResult.error.message}`,
    );
  }

  const index = indexResult.data as IndexManifest;

  // Carry EVERY key the index file declares, then replace only the two the
  // merge actually rebuilds.
  //
  // This used to be a hand-written list of seven fields, which silently dropped
  // `planes`, `mvk`, `invariants`, `agent_instructions`,
  // `relationship_patterns`, `version` and both side-car pointers from every
  // split manifest — no ADR, no comment, no test. The spread is also what the
  // monolithic branch above already does, so the two forms now agree by
  // construction instead of by anyone remembering to update a list. Spreading
  // the RAW parsed object rather than `indexResult.data` keeps nested values
  // byte-identical: the validated copy is narrowed by the inner (stripping)
  // `z.object`s of `IndexManifestSchema`.
  //
  // `version: '2.0'` rides along with the rest, and stays safe: `isIndexManifest`
  // additionally requires a `bounded_contexts` entry carrying a `file:` pointer,
  // and the merged entries are full records.
  const result: Manifest = {
    ...(parsed as Partial<Manifest>),
    // The (already-validated) stamp and the description fallback are the two
    // values the merge normalizes rather than copies.
    description: index.description ?? "Auto-generated manifest",
    bounded_contexts: [],
    apps: [],
  };

  // Resolve the `workspace_config:` pointer. The splitter moves `monorepo` and
  // `generator` OUT of the root manifest into this side-car (CATEGORY_B_KEYS in
  // packages/sync/src/commands/manifest/split.ts) and records the pointer here;
  // nothing read it back, so `manifest.monorepo?.archInvariants`,
  // `manifest.generator?.sync?.layers` and `generator.sync.stubs` were
  // permanently `undefined` for every split project. The merge is the inverse of
  // the split, so it owns the read.
  //
  // A pointer naming a file that is not there is FATAL, not a shrug: silently
  // continuing is precisely how the config went missing for this long, and the
  // caller would get a green load of a manifest that is missing half its
  // configuration. Same posture as the missing-context-file branch below.
  if (typeof index.workspace_config === "string") {
    assertPathWithinArchitecture(workspaceRoot, index.workspace_config);
    const sideCarPath = path.join(
      workspaceRoot,
      ".architecture",
      index.workspace_config,
    );

    let sideCarContent: string;
    try {
      sideCarContent = await fs.readFile(sideCarPath, "utf-8");
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        throw new Error(`Workspace config file not found: ${sideCarPath}`);
      }
      throw err;
    }

    const sideCarResult = WorkspaceConfigSchema.safeParse(
      yaml.load(sideCarContent),
    );
    if (!sideCarResult.success) {
      throw new Error(
        `Workspace config "${index.workspace_config}" validation failed: ${sideCarResult.error.message}`,
      );
    }

    const sideCar = sideCarResult.data;
    if (sideCar.monorepo !== undefined) {
      result.monorepo = sideCar.monorepo as Manifest["monorepo"];
    }
    if (sideCar.generator !== undefined) {
      result.generator = sideCar.generator as Manifest["generator"];
    }
  }

  const indexContexts = index.bounded_contexts ?? [];
  for (const entry of indexContexts) {
    // No pointer-less entry can reach this loop. `file` is REQUIRED on every
    // index entry (`IndexManifestSchema.bounded_contexts`, manifest-schema.ts),
    // so the `safeParse` above rejects the WHOLE file — loudly, naming the
    // offending index — the moment one entry lacks it. The `if (typeof
    // indexEntry.file !== "string") continue;` that used to stand here was
    // therefore unreachable, and had it ever become reachable it would have
    // dropped a real bounded context without a word: the exact class of failure
    // this file exists to stop. Pinned by "an index entry missing `file:` is
    // rejected by the index parse, never skipped" in manifest-merge-loader.test.ts.
    const indexEntry = entry as IndexBoundedContextEntry;

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
