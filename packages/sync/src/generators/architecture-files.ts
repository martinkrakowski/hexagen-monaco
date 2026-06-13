import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { SyncConfig } from "../config.js";
import { safeWriteFileAtomic, isInScope } from "../fs-utils.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
} from "../results.js";
import { interpolate } from "../template-engine.js";
import type {
  ArchInvariantsConfig,
  FileTemplate,
  Manifest,
} from "../types/manifest.js";
import { portName, resolveScope } from "../types/manifest.js";
import {
  LAYER_RULES_STRICT_ENTERPRISE,
  LAYER_RULES_MICRO_FRONTEND,
  LAYER_RULES_DEFAULT,
  LINTER_CONFIG_STRICT,
  LINTER_CONFIG_DEFAULT,
  GENERATOR_CONFIG_TEMPLATE,
} from "./architecture-file-templates.js";
import type { ReportRecorder } from "../domain/types.js";

function resolveWorkspaceTemplate(manifest: Manifest): string {
  const legacy = (manifest as { workspaceTemplate?: unknown })
    .workspaceTemplate;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;
  if (
    typeof manifest.architecture === "string" &&
    manifest.architecture.length > 0
  ) {
    return manifest.architecture;
  }
  return "modular-monolith";
}

function toPascalCase(stem: string): string {
  return stem
    .split(/[-.]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Render `value` for the VALUE side of a `key: value` ownership line. Real
 * bounded-context names (kebab/alnum, e.g. `catalog`, `search-api`) are plain
 * YAML scalars and emit bare, so collision-free manifests stay byte-identical.
 * A name that is NOT plain-safe — a leading YAML indicator (`@`, `*`, `&`, `!`,
 * `?`, `-`, `:` …), an embedded special, or a coercing word — is double-quoted
 * via JSON (JSON string escaping is a subset of YAML double-quote syntax), so
 * the document still parses and the value round-trips to the same string. On the
 * reserved list: `true`/`false`/`null` are what this repo's js-yaml v4 (YAML 1.2
 * core) actually coerces; `yes`/`no`/`on`/`off` are defensive cover for a
 * YAML-1.1 reader (v4 itself leaves them strings). C4 hardened the key side;
 * this does the same for the value, which was still a bare scalar.
 */
function yamlScalar(value: string): string {
  const plainSafe = /^[A-Za-z][A-Za-z0-9._-]*$/.test(value);
  const reserved = /^(?:true|false|null|yes|no|on|off)$/i.test(value);
  return plainSafe && !reserved ? value : JSON.stringify(value);
}

function buildOwnershipBlock(manifest: Manifest): {
  block: string;
  collisions: string[];
} {
  const contexts = manifest.bounded_contexts ?? [];

  // Pass 1 — collect (name, context) pairs in declaration order. Same-context
  // repeats (an in/out port pair sharing a stem is one ownership fact, not
  // two) dedupe to a single entry.
  const entries: Array<{ name: string; context: string }> = [];
  const seen = new Set<string>();
  const owners = new Map<string, Set<string>>();

  const add = (name: string, context: string): void => {
    const key = JSON.stringify([name, context]);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ name, context });
    let contextsForName = owners.get(name);
    if (!contextsForName) {
      contextsForName = new Set();
      owners.set(name, contextsForName);
    }
    contextsForName.add(context);
  };

  for (const bc of contexts) {
    if (bc.name === "shared") continue;
    const application = bc.layers?.application;
    const infrastructure = bc.layers?.infrastructure;

    for (const p of application?.ports?.in ?? []) {
      add(toPascalCase(portName(p).replace(/\.in-port\.ts$/, "")), bc.name);
    }
    for (const p of application?.ports?.out ?? []) {
      add(toPascalCase(portName(p).replace(/\.out-port\.ts$/, "")), bc.name);
    }
    for (const a of infrastructure?.adapters ?? []) {
      add(toPascalCase(a.replace(/\.adapter\.ts$/, "")), bc.name);
    }
  }

  // Pass 2 — emit. A name claimed by two contexts would be a duplicate YAML
  // mapping key (strict loaders throw on it) inside the same document whose
  // port-single-ownership invariant promises exactly one owner. Qualify ONLY
  // the contested names so every PREVIOUSLY-LOADABLE manifest stays
  // byte-identical: this and the pass-1 dedupe are the two divergences from
  // the old single-pass emission, and each only ever rewrites a document that
  // was already an unloadable duplicate-key crash. The qualifier is the RAW
  // context name in a double-quoted key (JSON string
  // escaping is valid YAML double-quote syntax): entries are unique
  // (name, context) pairs after the pass-1 dedupe and names never contain a
  // dot (toPascalCase strips them), so the emitted keys are unique by
  // construction — a normalized qualifier would be lossy ("api2"/"api-2"
  // both PascalCase to "Api2") and could reintroduce the duplicate-key
  // failure. Bare keys never contain a dot; qualified keys always do — the
  // namespaces stay disjoint.
  const collisions = [...owners.entries()]
    .filter(([, contextsForName]) => contextsForName.size > 1)
    .map(([name]) => name);
  const contested = new Set(collisions);

  const lines = entries.map(({ name, context }) =>
    contested.has(name)
      ? `      ${JSON.stringify(`${context}.${name}`)}: ${yamlScalar(context)}`
      : `      ${name}: ${yamlScalar(context)}`,
  );

  return {
    block: lines.length > 0 ? lines.join("\n") : "      # No ports declared",
    collisions,
  };
}

function buildInterpolationVars(manifest: Manifest): {
  vars: Record<string, string>;
  ownershipCollisions: string[];
} {
  const scope = resolveScope(manifest);
  const workspaceTemplate = resolveWorkspaceTemplate(manifest);
  const { block, collisions } = buildOwnershipBlock(manifest);
  return {
    vars: {
      scope,
      template: workspaceTemplate,
      workspaceTemplate,
      system: typeof manifest.system === "string" ? manifest.system : "",
      ownershipBlock: block,
    },
    ownershipCollisions: collisions,
  };
}

function builtInLayerRules(workspaceTemplate: string): string {
  if (workspaceTemplate === "strict-enterprise")
    return LAYER_RULES_STRICT_ENTERPRISE;
  if (workspaceTemplate === "micro-frontend") return LAYER_RULES_MICRO_FRONTEND;
  return LAYER_RULES_DEFAULT;
}

function builtInLinterConfig(workspaceTemplate: string): string {
  if (
    workspaceTemplate === "strict-enterprise" ||
    workspaceTemplate === "micro-frontend"
  ) {
    return LINTER_CONFIG_STRICT;
  }
  return LINTER_CONFIG_DEFAULT;
}

function resolveTemplate(
  slot: FileTemplate | undefined,
  fallback: string,
): string {
  if (slot?.template && slot.template.length > 0) return slot.template;
  return fallback;
}

function interpolateWithLogging(
  label: string,
  template: string,
  vars: Record<string, unknown>,
  config: SyncConfig,
): string {
  const { output, warnings } = interpolate(template, vars);
  if (warnings.length > 0) {
    const unique = Array.from(new Set(warnings));
    config.logger.warn(
      `architecture-files: unresolved placeholder${unique.length === 1 ? "" : "s"} in ${label}: ${unique.join(", ")}`,
    );
  }
  return output;
}

async function writeManifestIfFreshExternal(
  config: SyncConfig,
  result: GeneratorResult,
  report?: ReportRecorder,
): Promise<void> {
  if (config.mode !== "external") {
    return;
  }

  const archDir = path.join(config.workspaceRoot, ".architecture");
  const manifestPath = path.join(archDir, "manifest.yaml");
  const relative = path.relative(config.workspaceRoot, manifestPath);

  // This is a direct fs.writeFile (not via safeWriteFileAtomic), so it must
  // consult the --only scope itself — otherwise a scoped run could materialize
  // the bootstrap manifest outside the requested set.
  if (!isInScope(manifestPath, config)) {
    config.logger.debug(`skipped (outside --only) ${relative}`);
    result.skipped.push(manifestPath);
    return;
  }

  let exists = false;
  try {
    await fs.access(manifestPath);
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    config.logger.debug(
      `architecture-files: manifest.yaml already present — preserved (${relative})`,
    );
    result.skipped.push(manifestPath);
    return;
  }

  if (config.dryRun) {
    config.logger.info(`[DRY-RUN] would create ${relative}`);
    result.created.push(manifestPath);
    result.totalOps += 1;
    return;
  }

  const content = yaml.dump(config.manifest);
  // PR-B1 (RCA #4): this is a deliberate raw write (not safeWriteFileAtomic),
  // so it must journal itself. The exists-check above guarantees the file is
  // fresh — pre-image is null (a create), rolled back by unlinking.
  config.journal?.recordWrite(manifestPath, null);
  await fs.mkdir(archDir, { recursive: true });
  await fs.writeFile(manifestPath, content, { encoding: "utf8" });

  config.logger.info(`created ${relative}`);
  if (report)
    report.record(
      "created",
      manifestPath,
      "manifest materialised (external mode, fresh target)",
    );

  result.created.push(manifestPath);
  result.totalOps += 1;
}

export async function generateArchitectureFiles(
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  const manifest = config.manifest;
  const archRoot = path.join(config.workspaceRoot, ".architecture");
  const archInvariants: ArchInvariantsConfig | undefined =
    manifest.monorepo?.archInvariants;

  const { vars, ownershipCollisions } = buildInterpolationVars(manifest);
  const workspaceTemplate = vars.workspaceTemplate ?? "modular-monolith";

  if (ownershipCollisions.length > 0) {
    config.logger.warn(
      `architecture-files: ownership-registry name collision${ownershipCollisions.length === 1 ? "" : "s"} — ` +
        `${ownershipCollisions.join(", ")} declared by more than one context; ` +
        `emitted with context-qualified keys (the port-single-ownership invariant expects exactly one owner).`,
    );
  }

  await writeManifestIfFreshExternal(config, result, report);

  const layerRulesPath = path.join(archRoot, "invariants", "layer-rules.yaml");
  const layerRulesTemplate = resolveTemplate(
    archInvariants?.layerRules,
    builtInLayerRules(workspaceTemplate),
  );
  const layerRulesContent = interpolateWithLogging(
    "invariants/layer-rules.yaml",
    layerRulesTemplate,
    vars,
    config,
  );
  const layerRulesStatus = await safeWriteFileAtomic(
    layerRulesPath,
    layerRulesContent,
    config,
    report,
    true,
  );
  recordWriteStatus(result, layerRulesPath, layerRulesStatus);

  const linterConfigPath = path.join(
    archRoot,
    "invariants",
    "linter-config.yaml",
  );
  const linterConfigTemplate = resolveTemplate(
    archInvariants?.linterConfig,
    builtInLinterConfig(workspaceTemplate),
  );
  const linterConfigContent = interpolateWithLogging(
    "invariants/linter-config.yaml",
    linterConfigTemplate,
    vars,
    config,
  );
  const linterConfigStatus = await safeWriteFileAtomic(
    linterConfigPath,
    linterConfigContent,
    config,
    report,
    true,
  );
  recordWriteStatus(result, linterConfigPath, linterConfigStatus);

  const generatorConfigPath = path.join(archRoot, "generator.config.yaml");
  const generatorConfigTemplate = resolveTemplate(
    archInvariants?.generatorConfig,
    GENERATOR_CONFIG_TEMPLATE,
  );
  const generatorConfigContent = interpolateWithLogging(
    "generator.config.yaml",
    generatorConfigTemplate,
    vars,
    config,
  );
  const generatorConfigStatus = await safeWriteFileAtomic(
    generatorConfigPath,
    generatorConfigContent,
    config,
    report,
    true,
  );
  recordWriteStatus(result, generatorConfigPath, generatorConfigStatus);

  return result;
}
