import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { SyncConfig } from "../config.js";
import { safeWriteFileAtomic, isInScope } from "../fs-utils.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
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

function buildOwnershipBlock(manifest: Manifest): string {
  const contexts = manifest.bounded_contexts ?? [];
  const entries: string[] = [];

  for (const bc of contexts) {
    if (bc.name === "shared") continue;
    const application = bc.layers?.application;
    const infrastructure = bc.layers?.infrastructure;

    for (const p of application?.ports?.in ?? []) {
      const name = toPascalCase(portName(p).replace(/\.in-port\.ts$/, ""));
      entries.push(`      ${name}: ${bc.name}`);
    }
    for (const p of application?.ports?.out ?? []) {
      const name = toPascalCase(portName(p).replace(/\.out-port\.ts$/, ""));
      entries.push(`      ${name}: ${bc.name}`);
    }
    for (const a of infrastructure?.adapters ?? []) {
      const name = toPascalCase(a.replace(/\.adapter\.ts$/, ""));
      entries.push(`      ${name}: ${bc.name}`);
    }
  }

  return entries.length > 0 ? entries.join("\n") : "      # No ports declared";
}

function buildInterpolationVars(manifest: Manifest): Record<string, string> {
  const scope = resolveScope(manifest);
  const workspaceTemplate = resolveWorkspaceTemplate(manifest);
  return {
    scope,
    template: workspaceTemplate,
    workspaceTemplate,
    system: typeof manifest.system === "string" ? manifest.system : "",
    ownershipBlock: buildOwnershipBlock(manifest),
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

function recordStatus(
  result: GeneratorResult,
  filePath: string,
  status: "created" | "updated" | "unchanged" | "skipped" | "protected",
): void {
  if (status === "created") result.created.push(filePath);
  else if (status === "updated") result.updated.push(filePath);
  else if (status === "skipped" || status === "protected")
    result.skipped.push(filePath);
  if (status === "created" || status === "updated") result.totalOps += 1;
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

  const vars = buildInterpolationVars(manifest);
  const workspaceTemplate = vars.workspaceTemplate ?? "modular-monolith";

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
  recordStatus(result, layerRulesPath, layerRulesStatus);

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
  recordStatus(result, linterConfigPath, linterConfigStatus);

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
  recordStatus(result, generatorConfigPath, generatorConfigStatus);

  return result;
}
