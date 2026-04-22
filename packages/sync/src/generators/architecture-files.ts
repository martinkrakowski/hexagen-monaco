// architecture-files.ts — `.architecture/**` generator for SyncEngine.
//
// Wave 2c of sync-engine-unified-scaffolding (plan §Phase 2).
//
// Produces four files inside `${workspaceRoot}/.architecture/`:
//
//   1. manifest.yaml              — written ONLY in external mode when absent.
//                                   ALWAYS protected: self-regen never touches it,
//                                   and a retry against a partially-materialised
//                                   external target is a no-op.
//   2. invariants/layer-rules.yaml       — manifest template or built-in fallback
//   3. invariants/linter-config.yaml     — manifest template or built-in fallback
//   4. generator.config.yaml             — manifest template or built-in fallback
//
// Templates for (2)-(4) live under `manifest.monorepo.archInvariants` and are
// interpolated against a small flat variable map (see `buildInterpolationVars`).
// When a section is absent, a built-in fallback is used — this preserves the
// current adapter's behaviour (ported verbatim from
// `packages/project-generation/src/infrastructure/adapters/root-files.ts`,
// which will be deleted in Wave 6a).
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { SyncConfig } from "../config.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { interpolate } from "../template-engine.js";
import type {
  ArchInvariantsConfig,
  FileTemplate,
  Manifest,
} from "../types/manifest.js";

type ReportRecorder = {
  record: (type: string, target: string, message: string) => void;
};

// ---------------------------------------------------------------------------
// Built-in fallback templates (ported from root-files.ts).
// Hardcoded string substitutions in the original are replaced with
// `{variable}` placeholders consumed by `interpolate()`.
// ---------------------------------------------------------------------------

const LAYER_RULES_COMMON = `shared_kernel:
  package: "@{scope}/shared"
  allowed_in_all_layers: true

layers:
  domain:
    access_rule: "internal-only"
    allowed_imports: ["@{scope}/shared"]

  application:
    access_rule: "ports-only"
    allowed_imports: ["domain", "@{scope}/shared"]

  infrastructure:
    access_rule: "adapters"
    allowed_imports: ["domain", "application", "@{scope}/shared"]
`;

const LAYER_RULES_STRICT_ENTERPRISE = `# HexaGen — Architectural Invariants
# Template: strict-enterprise — event-bus boundaries

${LAYER_RULES_COMMON}
cross_context:
  deny_direct_imports: true
  required_communication: "event-bus"
  allowed_broker_patterns:
    - "event-bus"
    - "message-queue"
`;

const LAYER_RULES_MICRO_FRONTEND = `# HexaGen — Architectural Invariants
# Template: micro-frontend — networked boundaries

${LAYER_RULES_COMMON}
cross_context:
  deny_direct_imports: true
  required_communication: "network"
  allowed_broker_patterns:
    - "network-rpc"
    - "http-api"
`;

const LAYER_RULES_DEFAULT = `# HexaGen — Architectural Invariants
# Template: {template} (flexible mode)

${LAYER_RULES_COMMON}`;

const LINTER_CONFIG_STRICT = `# Rules for @hexagen/arch-linter
# Template: {template} (strict mode)

global_whitelist:
  - "@{scope}/shared"
  - "@{scope}/shared/**"

cross_context_rules:
  deny_sibling_imports: true
  require_port_interface: true

test_double_rules:
  allowed_cross_package_imports: true
`;

const LINTER_CONFIG_DEFAULT = `# Rules for @hexagen/arch-linter
# Template: {template} (flexible mode)

global_whitelist:
  - "@{scope}/shared"
  - "@{scope}/shared/**"

test_double_rules:
  allowed_cross_package_imports: true
`;

const GENERATOR_CONFIG_TEMPLATE = `generator:
  version: "1.0"
  description: "Global invariants and safety rules"
  workspace_template: "{workspaceTemplate}"

  invariants:
    - name: composite-safety
      description: "Every tsconfig.json must contain paths: {{}} to override inherited source mappings."
      priority: critical
      failure: abort-and-cleanup

    - name: barrel-ownership-boundary
      description: "Barrels may only re-export types owned by the current bounded context."
      priority: critical
      failure: abort-and-cleanup

    - name: port-single-ownership
      description: "Each port interface belongs to exactly one bounded context."
      priority: critical
      failure: abort-and-cleanup

    - name: dependency-consistency
      description: "Every @hexagen/* import must have a matching entry in package.json."
      priority: high
      failure: abort

    - name: self-import-prevention
      description: "No package imports itself by name."
      priority: high
      failure: abort

    - name: signature-synchronization
      description: "Generated consumers must derive exact signatures from the canonical port."
      priority: high
      failure: abort

    - name: no-empty-stubs
      description: "No empty barrels (export {{}}) in src/."
      priority: medium
      failure: warn-and-continue

    - name: exports-field-mandatory
      description: "Every package.json must include a complete exports map."
      priority: medium
      failure: warn-and-continue

    - name: test-double-parity
      description: "Test doubles must implement the same interface as the canonical port."
      priority: medium
      failure: warn-and-continue

  bootstrap-sequence:
    - load-ownership-map
    - validate-port-ownership-map
    - generate-package-skeleton
    - enforce-tsconfig-paths-override
    - generate-exports-field
    - synchronize-signatures
    - validate-barrel-chain
    - enforce-dependency-consistency
    - final-composite-reference-check

  failure-behavior:
    critical: abort-and-cleanup
    high: abort
    medium: warn-and-continue

  ownership-registry:
    ports:
{ownershipBlock}
`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective workspace-template identifier used for invariant
 * template selection. Callers may declare this either via the legacy
 * `workspaceTemplate` top-level field (what the old adapter read) or via the
 * standard top-level `architecture` field (what the current manifest uses).
 * Falls back to `"modular-monolith"` — the default both places converge on.
 */
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

/**
 * Derive `scope` from the manifest. Used inside invariant templates for
 * `@{scope}/shared` whitelists. Defaults to `"hexagen"` to match historical
 * behaviour when the manifest omits `scope`.
 */
function resolveScope(manifest: Manifest): string {
  if (typeof manifest.scope === "string" && manifest.scope.length > 0) {
    return manifest.scope;
  }
  return "hexagen";
}

/**
 * Capitalise each `-` / `.`-separated segment of an identifier stem and
 * concatenate. Mirrors the PascalCase conversion performed by the original
 * adapter's `generateGeneratorConfig` ownership block.
 */
function toPascalCase(stem: string): string {
  return stem
    .split(/[-.]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Build the indented YAML body listing every port / adapter and its owning
 * bounded context. Ported from `generateGeneratorConfig` in root-files.ts.
 * Returns a ready-to-inject multi-line string with 6-space indentation
 * (to fit under `ownership-registry.ports:` at 4-space depth).
 */
function buildOwnershipBlock(manifest: Manifest): string {
  const contexts = manifest.bounded_contexts ?? [];
  const entries: string[] = [];

  for (const bc of contexts) {
    if (bc.name === "shared") continue;
    const application = bc.layers?.application;
    const infrastructure = bc.layers?.infrastructure;

    for (const p of application?.ports?.in ?? []) {
      const name = toPascalCase(p.replace(/\.in-port\.ts$/, ""));
      entries.push(`      ${name}: ${bc.name}`);
    }
    for (const p of application?.ports?.out ?? []) {
      const name = toPascalCase(p.replace(/\.out-port\.ts$/, ""));
      entries.push(`      ${name}: ${bc.name}`);
    }
    for (const a of infrastructure?.adapters ?? []) {
      const name = toPascalCase(a.replace(/\.adapter\.ts$/, ""));
      entries.push(`      ${name}: ${bc.name}`);
    }
  }

  return entries.length > 0 ? entries.join("\n") : "      # No ports declared";
}

/**
 * Build the flat variable map fed to `interpolate()` for all architecture-file
 * templates. Kept flat (no nested access) to match the template engine's
 * contract (see `template-engine.ts`).
 */
function buildInterpolationVars(manifest: Manifest): Record<string, string> {
  const scope = resolveScope(manifest);
  const workspaceTemplate = resolveWorkspaceTemplate(manifest);
  return {
    scope,
    // The old adapter treated `template` and `workspaceTemplate` as the same
    // concept; expose both identifiers so fallback and manifest-supplied
    // templates can use either consistently.
    template: workspaceTemplate,
    workspaceTemplate,
    system: typeof manifest.system === "string" ? manifest.system : "",
    ownershipBlock: buildOwnershipBlock(manifest),
  };
}

/**
 * Resolve the built-in layer-rules fallback for the given workspace template,
 * mirroring `generateLayerRules` in root-files.ts.
 */
function builtInLayerRules(workspaceTemplate: string): string {
  if (workspaceTemplate === "strict-enterprise")
    return LAYER_RULES_STRICT_ENTERPRISE;
  if (workspaceTemplate === "micro-frontend") return LAYER_RULES_MICRO_FRONTEND;
  return LAYER_RULES_DEFAULT;
}

/**
 * Resolve the built-in linter-config fallback for the given workspace
 * template, mirroring `generateLinterConfig` in root-files.ts.
 */
function builtInLinterConfig(workspaceTemplate: string): string {
  if (
    workspaceTemplate === "strict-enterprise" ||
    workspaceTemplate === "micro-frontend"
  ) {
    return LINTER_CONFIG_STRICT;
  }
  return LINTER_CONFIG_DEFAULT;
}

/**
 * Resolve the raw template string for an `archInvariants` slot. Falls back to
 * the built-in string if the manifest does not declare one.
 */
function resolveTemplate(
  slot: FileTemplate | undefined,
  fallback: string,
): string {
  if (slot?.template && slot.template.length > 0) return slot.template;
  return fallback;
}

/**
 * Run a template body through `interpolate()` and forward any missing-variable
 * warnings to `config.logger.warn()`. The `label` identifies which generated
 * file the warnings belong to so operators can trace them.
 */
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

/**
 * Record a safeWriteFileAtomic status against the given `GeneratorResult`
 * bucket. Keeps the bookkeeping identical across every slot.
 */
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

// ---------------------------------------------------------------------------
// manifest.yaml — special handling (ALWAYS protected)
// ---------------------------------------------------------------------------

/**
 * Materialise `.architecture/manifest.yaml` when operating in external mode
 * against a fresh target. No-op in every other scenario:
 *
 *   - self-regen mode: the file is the input; never overwrite.
 *   - external mode, file exists (retry): preserve — never overwrite.
 *
 * Writes directly via `fs.writeFile` rather than `safeWriteFileAtomic` so the
 * "ALWAYS protected" invariant is enforced at the generator boundary, not
 * delegated to the `forceRoot` flag (which would allow an overwrite the plan
 * explicitly forbids).
 */
async function writeManifestIfFreshExternal(
  config: SyncConfig,
  result: GeneratorResult,
  report?: ReportRecorder,
): Promise<void> {
  if (config.mode !== "external") {
    // Self-regen never writes manifest.yaml.
    return;
  }

  const archDir = path.join(config.workspaceRoot, ".architecture");
  const manifestPath = path.join(archDir, "manifest.yaml");
  const relative = path.relative(config.workspaceRoot, manifestPath);

  let exists = false;
  try {
    await fs.access(manifestPath);
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    // External retry against a partially-materialised target: do not touch.
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

// ---------------------------------------------------------------------------
// Public generator
// ---------------------------------------------------------------------------

/**
 * Emit the `.architecture/**` files for a target monorepo.
 *
 * Pipeline:
 *   1. Conditionally create `manifest.yaml` (external + fresh target only).
 *   2. Write `invariants/layer-rules.yaml`.
 *   3. Write `invariants/linter-config.yaml`.
 *   4. Write `generator.config.yaml`.
 *
 * Templates for (2)-(4) resolve in this order:
 *   manifest.monorepo.archInvariants[<slot>].template  →  built-in fallback
 *
 * All three carry `skipGeneratedCheck = true` because invariant YAMLs are
 * commented rather than `@generated`-marked; they are still protected at the
 * root-file level by `isProtectedRoot` (self-regen requires `--force-root`,
 * external mode passes `forceRoot: true` via `ExternalSyncEngineAdapter`).
 *
 * Errors from the underlying file I/O bubble up to the caller; missing
 * manifest sections are NOT errors and quietly fall back to built-ins.
 */
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

  // 1. manifest.yaml — ALWAYS protected; special handling.
  await writeManifestIfFreshExternal(config, result, report);

  // 2. layer-rules.yaml
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

  // 3. linter-config.yaml
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

  // 4. generator.config.yaml
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
