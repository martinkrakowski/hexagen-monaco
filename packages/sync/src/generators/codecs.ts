// packages/sync/src/generators/codecs.ts
//
// Lane H2: emits `<PortName>.codec.ts` for every application port (`in`/`out`)
// declaring `contracts:`. The manifest is UNTRUSTED (callers may pass an
// in-memory `SyncEngineOptions.manifest`), so traversal goes exclusively
// through the descriptor-based helpers in codec-schema-builder.ts — accessors
// are never invoked, Proxy trap throws are refused, sparse holes and
// array-likes are refused, and bounds are enforced before iterating.
//
// Cost bound: O(C + P * N) — MAX_BOUNDED_CONTEXTS=64 contexts, at most
// MAX_PORTS_PER_DIRECTION=64 ports per direction, and MAX_TOTAL_NODES=512
// schema nodes per port contract.

import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import { isInScope, safeWriteFileAtomic } from "../fs-utils.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
  type WriteStatus,
} from "../results.js";
import type { ReportRecorder } from "../domain/types.js";
import {
  ok,
  err,
  type Result,
} from "../domain/services/codec-schema-builder.js";
import {
  resolveEmissionDir,
  type LayersConfig,
} from "../domain/services/layer-dir-resolver.js";
import {
  buildCodecSchema,
  readDenseArray,
  readOwnDataProperty,
  renderCodecModule,
  resolveRuntimeModule,
  CodecGeneratorError,
} from "../domain/services/codec-schema-builder.js";
import { normalizeStubName } from "./stubs.js";
import { DEFAULT_NAMING } from "../domain/stub-templates.js";

/** Hard traversal bounds for the manifest walk (see header cost bound). */
export const MAX_BOUNDED_CONTEXTS = 64;
export const MAX_PORTS_PER_DIRECTION = 64;

export async function generateCodecs(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  try {
    // Runtime-module and layer resolution also read untrusted manifest data —
    // keep them inside the same boundary so any typed refusal (or, as a last
    // resort, any escape) becomes result.error, never a thrown abort.
    const runtimeModuleResult = resolveRuntimeModule(config.manifest);
    if (!runtimeModuleResult.success) {
      result.error = runtimeModuleResult.error;
      return result;
    }
    const runtimeModule = runtimeModuleResult.value;

    // Layer-folder configuration lives under generator.sync.layers — read it
    // through the same descriptor boundary; absence falls back to the
    // conventional dirs inside resolveEmissionDir.
    const layersResult = readLayersConfig(config.manifest);
    if (!layersResult.success) {
      result.error = layersResult.error;
      return result;
    }
    const layersConfig = layersResult.value;

    return await emitCodecs(
      moduleDir,
      moduleName,
      config,
      report,
      result,
      runtimeModule,
      layersConfig,
    );
  } catch (thrown) {
    // Failed-soft generator contract (B-1): a thrown traversal error (e.g. a
    // hostile getter that survives the descriptor checks in an unexpected
    // position) still surfaces as result.error — never an abort, never a pass.
    result.error =
      thrown instanceof CodecGeneratorError
        ? thrown
        : thrown instanceof Error
          ? thrown
          : new Error(String(thrown));
    return result;
  }
}

/**
 * Read `generator.sync.layers` WITHOUT ever letting `resolveEmissionDir`
 * perform ordinary property reads on the untrusted object: `layers.application`
 * and `layers.application.folder` are copied through own data descriptors
 * (accessors and throwing traps are refused by `readOwnDataProperty`), and
 * only the sanitized copy reaches `resolveEmissionDir`. Values the resolver
 * would reject anyway (non-string folders) are dropped, preserving the
 * `src/<layer>` fallback for them.
 */
function readLayersConfig(
  manifest: unknown,
): Result<LayersConfig | undefined, CodecGeneratorError> {
  const gen = readOwnDataProperty(manifest, "generator", "generator");
  if (!gen.success) return gen;
  if (gen.value === undefined) return ok(undefined);
  const sync = readOwnDataProperty(gen.value, "sync", "generator.sync");
  if (!sync.success) return sync;
  if (sync.value === undefined) return ok(undefined);
  const layers = readOwnDataProperty(
    sync.value,
    "layers",
    "generator.sync.layers",
  );
  if (!layers.success) return layers;
  const layersRaw = layers.value;
  if (layersRaw === undefined) return ok(undefined);

  // Copy the ONLY shape resolveEmissionDir touches for codec emission:
  // `application.folder`. Accessors on `application` or `folder` are refused
  // here — before resolveEmissionDir is ever called.
  const app = readOwnDataProperty(
    layersRaw,
    "application",
    "generator.sync.layers.application",
  );
  if (!app.success) return app;
  if (app.value === undefined) return ok({});
  const folder = readOwnDataProperty(
    app.value,
    "folder",
    "generator.sync.layers.application.folder",
  );
  if (!folder.success) return folder;
  const folderValue = folder.value;
  if (folderValue !== undefined && typeof folderValue !== "string") {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        "generator.sync.layers.application.folder",
        `layer "folder" at generator.sync.layers.application.folder is not a string`,
      ),
    );
  }
  return ok({
    application: { folder: folderValue as string | undefined },
  } as LayersConfig);
}

async function emitCodecs(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig,
  report: ReportRecorder | undefined,
  result: GeneratorResult,
  runtimeModule: string,
  layersConfig: LayersConfig | undefined,
): Promise<GeneratorResult> {
  const manifest: unknown = config.manifest;

  const bcsResult = readOwnDataProperty(
    manifest,
    "bounded_contexts",
    "bounded_contexts",
  );
  if (!bcsResult.success) {
    result.error = bcsResult.error;
    return result;
  }
  if (bcsResult.value === undefined) return result; // no contexts — nothing to emit

  const bcs = readDenseArray(
    bcsResult.value,
    MAX_BOUNDED_CONTEXTS,
    "bounded_contexts",
  );
  if (!bcs.success) {
    result.error = bcs.error;
    return result;
  }

  let context: unknown;
  let found = false;
  for (const rawContext of bcs.value) {
    const nameResult = readOwnDataProperty(
      rawContext,
      "name",
      "bounded_contexts[].name",
    );
    if (!nameResult.success) {
      result.error = nameResult.error;
      return result;
    }
    if (nameResult.value === moduleName) {
      context = rawContext;
      found = true;
      break;
    }
  }
  if (!found) return result; // context not declared — nothing to emit

  const layersResult = readOwnDataProperty(context, "layers", "layers");
  if (!layersResult.success) {
    result.error = layersResult.error;
    return result;
  }
  if (layersResult.value === undefined) return result;

  const appResult = readOwnDataProperty(
    layersResult.value,
    "application",
    "layers.application",
  );
  if (!appResult.success) {
    result.error = appResult.error;
    return result;
  }
  if (appResult.value === undefined) return result;

  const portsResult = readOwnDataProperty(
    appResult.value,
    "ports",
    "layers.application.ports",
  );
  if (!portsResult.success) {
    result.error = portsResult.error;
    return result;
  }
  if (portsResult.value === undefined) return result;

  for (const direction of ["in", "out"] as const) {
    const dirResult = readOwnDataProperty(
      portsResult.value,
      direction,
      `layers.application.ports.${direction}`,
    );
    if (!dirResult.success) {
      result.error = dirResult.error;
      return result;
    }
    if (dirResult.value === undefined) continue;

    const ports = readDenseArray(
      dirResult.value,
      MAX_PORTS_PER_DIRECTION,
      `layers.application.ports.${direction}`,
    );
    if (!ports.success) {
      result.error = ports.error;
      return result;
    }

    const subdir = resolveEmissionDir(
      layersConfig,
      `application/ports/${direction}`,
    );

    for (const port of ports.value) {
      const emitted = await emitPortCodec(
        port,
        direction,
        moduleDir,
        subdir,
        moduleName,
        runtimeModule,
        config,
        report,
        result,
      );
      if (!emitted) return result; // result.error already set
    }
  }

  return result;
}

/**
 * Emit one port codec. Returns false (with `result.error` set) when the run
 * must stop; true when the port was emitted, skipped, or carried no contract.
 */
async function emitPortCodec(
  port: unknown,
  direction: "in" | "out",
  moduleDir: string,
  subdir: string,
  moduleName: string,
  runtimeModule: string,
  config: SyncConfig,
  report: ReportRecorder | undefined,
  result: GeneratorResult,
): Promise<boolean> {
  // String port entries (legacy name-only form) declare no contracts.
  if (typeof port === "string") return true;

  const contractsResult = readOwnDataProperty(
    port,
    "contracts",
    `${moduleName}.ports.${direction}[].contracts`,
  );
  if (!contractsResult.success) {
    result.error = contractsResult.error;
    return false;
  }
  // Contractless port (absent OR own value undefined): nothing to emit.
  if (contractsResult.value === undefined) return true;

  const nameResult = readOwnDataProperty(
    port,
    "name",
    `${moduleName}.ports.${direction}[].name`,
  );
  if (!nameResult.success) {
    result.error = nameResult.error;
    return false;
  }
  const rawName = nameResult.value;
  if (typeof rawName !== "string" || rawName.length === 0) {
    result.error = new CodecGeneratorError(
      "MALFORMED_CONTRACT",
      `${moduleName}.ports.${direction}[].name`,
      `port "name" must be a non-empty string`,
    );
    return false;
  }

  const namingTemplate =
    direction === "in" ? DEFAULT_NAMING.inPort : DEFAULT_NAMING.outPort;
  const portPascalName = normalizeStubName(rawName, namingTemplate);

  const filePath = path.join(moduleDir, subdir, `${portPascalName}.codec.ts`);

  const schemaResult = buildCodecSchema(
    contractsResult.value,
    `${moduleName}.${portPascalName}`,
  );
  if (!schemaResult.success) {
    // Never silently skip a malformed contract — surface and stop.
    result.error = schemaResult.error;
    return false;
  }

  const content = renderCodecModule({
    portName: portPascalName,
    schemaId: `${moduleName}.${portPascalName}`,
    runtimeModule,
    schema: schemaResult.value,
  });

  if (!isInScope(filePath, config)) {
    config.logger.debug(
      `skipped (outside --only) ${path.relative(config.workspaceRoot, filePath)}`,
    );
    recordWriteStatus(result, filePath, "skipped");
    return true;
  }

  // Keep the mkdir explicit and gated like writeStubFile (PR-A2): dry-run
  // plans the write without creating any directory.
  if (!config.dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  const status: WriteStatus = await safeWriteFileAtomic(
    filePath,
    content,
    config,
    report,
    false,
  );
  recordWriteStatus(result, filePath, status);
  return true;
}
