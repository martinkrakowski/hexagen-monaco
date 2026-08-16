import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import { safeWriteFileAtomic, isInScope } from "../fs-utils.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
  type WriteStatus,
} from "../results.js";
import type {
  BoundedContext,
  StubNaming,
  StubTemplates,
  StubsConfig,
} from "../types/manifest.js";
import { portName, resolveScope } from "../types/manifest.js";
import {
  analyzePortFile,
  generateAdapterFromPort,
  generateUseCaseFromPort,
  relativeImportSpecifier,
  type UseCaseOutPort,
} from "./port-analyzer.js";
import { DEFAULT_TEMPLATES, DEFAULT_NAMING } from "./stubs/stub-templates.js";
import type { StubKind } from "./stubs/stub-templates.js";
import { buildEmissionPlan } from "../domain/services/emission-plan-builder.js";
import {
  resolveEmissionDir,
  type LayersConfig,
} from "../domain/services/layer-dir-resolver.js";
import { toPascalCaseIdentifier } from "../domain/services/name-normalizer.js";
import type { ReportRecorder } from "../domain/types.js";
import {
  interpolateWithLog,
  type StubInterpolationContext,
} from "../domain/services/stub-template-resolver.js";

function resolveTemplate(
  kind: StubKind,
  manifestTemplates: StubTemplates | undefined,
): string {
  return manifestTemplates?.[kind] ?? DEFAULT_TEMPLATES[kind];
}

function resolveNaming(
  kind: StubKind,
  contextNaming: StubNaming | undefined,
  manifestNaming: StubNaming | undefined,
): string {
  return (
    contextNaming?.[kind] ?? manifestNaming?.[kind] ?? DEFAULT_NAMING[kind]
  );
}

async function writeStubFile(
  filePath: string,
  content: string,
  config: SyncConfig,
  report: ReportRecorder | undefined,
): Promise<WriteStatus> {
  // Out-of-scope under --only: skip before the stat/mkdir so no directory is
  // created (safeWriteFileAtomic enforces the same check for the write).
  if (!isInScope(filePath, config)) {
    config.logger.debug(
      `skipped (outside --only) ${path.relative(config.workspaceRoot, filePath)}`,
    );
    return "skipped";
  }

  try {
    await fs.stat(filePath);
    const relative = path.relative(config.workspaceRoot, filePath);
    config.logger.debug(`stub preserved ${relative}`);
    if (report) {
      report.record(
        "skipped",
        filePath,
        "stub already exists — preserving user content",
      );
    }
    return "skipped";
  } catch (err) {
    if (
      !(err instanceof Error) ||
      (err as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw err;
    }
  }

  // PR-A2: gate the mkdir under dry-run (it ran even with --dry-run). Real
  // runs keep it even though safeWriteFileAtomic mkdirs too — every mutation
  // site stays explicit for the B1 write-journal sweep.
  if (!config.dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }
  return safeWriteFileAtomic(filePath, content, config, report, false);
}

async function tryAnalyzeRelatedPort(
  moduleDir: string,
  name: string,
  kind: "adapter" | "useCase",
  context: BoundedContext,
  relatedPortNamingTemplate: string,
  layersConfig: LayersConfig | undefined,
): Promise<ReturnType<typeof analyzePortFile>> {
  const portType = kind === "adapter" ? "out" : "in";
  // Probe where the port is actually EMITTED (the A2 resolver), not the
  // conventional `src/application/ports/*` — with a custom
  // `application.folder` the conventional probe would always miss and every
  // adapter/use-case would silently degrade to a generic stub.
  const portSubdir = resolveEmissionDir(
    layersConfig,
    `application/ports/${portType}`,
  );

  const derivedPortName = name.replace(/Adapter$|UseCase$/, "Port");

  const declaredPorts =
    portType === "in"
      ? context.layers?.application?.ports?.in || []
      : context.layers?.application?.ports?.out || [];

  // Compare on the NORMALIZED port stem for BOTH adapters and use-cases (#245,
  // #248). Declared ports may be kebab/extensioned (`user-repo.out-port.ts`,
  // `place-order.in-port.ts`) while `derivedPortName` comes from the
  // already-normalized stub `name`, so a raw `===` would miss a genuinely
  // correlated port — leaving the stub generic instead of implementing its port.
  // Both `generateAdapterFromPort` and `generateUseCaseFromPort` now emit valid,
  // self-importing output (the use-case imports its in-port interface and injects
  // out-ports by resolved interface name — #248), so resolving is safe for both.
  if (
    !declaredPorts.some(
      (p) =>
        normalizeStubName(portName(p), relatedPortNamingTemplate) ===
        derivedPortName,
    )
  ) {
    return null;
  }

  const possibleFilenames = [
    `${derivedPortName}.${portType}-port.ts`,
    `${derivedPortName.toLowerCase()}.${portType}-port.ts`,
    `${derivedPortName}.ts`,
  ];

  for (const filename of possibleFilenames) {
    // portSubdir is package-root-relative (it already carries the configured
    // or conventional `src/...` layer folder) — no extra "src" segment here.
    const portFilePath = path.join(moduleDir, portSubdir, filename);
    const analysis = analyzePortFile(portFilePath);
    if (analysis) {
      return analysis;
    }
  }

  return null;
}

/**
 * Normalize a manifest layer name into a clean base used as BOTH the stub's file
 * stem and its TS identifier (#242). Manifest producers vary: some emit a bare
 * name (`OrderRepository`), some already append the kind extension
 * (`rest-controller.in-port.ts`, from the wizard's getInboundPortName), and the
 * port-type vocabulary is kebab-case (`relational-db`). Strip the kind's own
 * extension if the value already carries it (so the naming template adds it
 * exactly once instead of `…in-port.ts.in-port.ts`), then PascalCase — so the
 * content template's `{name}Port`/`{name}Adapter` is a valid identifier rather
 * than `interface rest-controller.in-port.tsPort`. A no-op for names that are
 * already clean PascalCase. The PascalCase/identifier step is the shared
 * `toPascalCaseIdentifier` (A3) — the same normalizer `architecture-files.ts`
 * and `cross-context.ts` render names with, so a stub identifier and its
 * ownership-registry/cross-context rendering can never drift apart again.
 */
export function normalizeStubName(
  rawName: string,
  namingTemplate: string,
): string {
  // The extension is the part of the template AFTER the last `{name}` — not the
  // whole template minus the token. Naming templates may carry a prefix/path or
  // other placeholders before `{name}` (e.g. `ports/in/{name}.in-port.ts`,
  // `{scope}-{name}.in-port.ts`); using `replace("{name}","")` there would yield a
  // bogus suffix, `endsWith` would miss, and the doubled-extension would survive.
  const placeholder = "{name}";
  const idx = namingTemplate.lastIndexOf(placeholder);
  const ext = idx >= 0 ? namingTemplate.slice(idx + placeholder.length) : "";
  const base =
    ext && rawName.endsWith(ext) ? rawName.slice(0, -ext.length) : rawName;
  return toPascalCaseIdentifier(base);
}

export async function generateStubs(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  const stubs: StubsConfig | undefined = config.manifest.generator?.sync?.stubs;

  if (!stubs || stubs.enabled !== true) {
    return result;
  }

  const context = config.manifest.bounded_contexts?.find(
    (c) => c.name === moduleName,
  );
  if (!context) {
    config.logger.debug(
      `generateStubs: no bounded context named '${moduleName}' in manifest`,
    );
    return result;
  }

  // Resolve every emission directory from `generator.sync.layers` (A2) so
  // stub placement, the layer-folder scaffold, and the related-port probe all
  // agree on one tree.
  const layersConfig: LayersConfig | undefined =
    config.manifest.generator?.sync?.layers;

  const plan = buildEmissionPlan(context, layersConfig);
  if (plan.length === 0) {
    config.logger.debug(
      `generateStubs: no layer declarations for '${moduleName}'`,
    );
    return result;
  }

  const manifestTemplates = stubs.templates;
  const manifestNaming = stubs.naming;
  const contextNaming = context.generator?.stubs?.naming;

  // The template resolver is domain code and takes only what it needs — a
  // resolved scope and somewhere to put warnings — never the composition-root
  // config (HEX-038). Projecting SyncConfig onto that contract is this
  // generator's job, and `resolveScope(config.manifest)` here matches what
  // apps/tsconfig/package-json/root-files already do. `warn` is wrapped in an
  // arrow rather than passed as `config.logger.warn` so the logger keeps its
  // receiver.
  const interpolation: StubInterpolationContext = {
    scope: resolveScope(config.manifest),
    warn: (message) => config.logger.warn(message),
  };

  for (const { kind, subdir, names } of plan) {
    const contentTemplate = resolveTemplate(kind, manifestTemplates);
    const namingTemplate = resolveNaming(kind, contextNaming, manifestNaming);

    for (const rawName of names) {
      // Normalize once (the single point where a name becomes a file stem AND an
      // identifier) — see normalizeStubName. Fixes doubled extensions and invalid
      // identifiers for kebab/extensioned manifest names (#242).
      const name = normalizeStubName(rawName, namingTemplate);
      const filename = interpolateWithLog(
        namingTemplate,
        name,
        `stubs.naming.${kind}`,
        interpolation,
      );

      // `subdir` comes RESOLVED from the emission plan (package-root-relative,
      // configured or conventional `src/...` folder included) — see A2.
      const filePath = path.join(moduleDir, subdir, filename);
      let content: string;

      if (kind === "adapter" || kind === "useCase") {
        // The related port is an out-port for adapters, an in-port for use-cases;
        // resolve its naming template so its declared names can be normalized the
        // same way its files are (see tryAnalyzeRelatedPort).
        const relatedPortNaming = resolveNaming(
          kind === "adapter" ? "outPort" : "inPort",
          contextNaming,
          manifestNaming,
        );
        const portAnalysis = await tryAnalyzeRelatedPort(
          moduleDir,
          name,
          kind,
          context,
          relatedPortNaming,
          layersConfig,
        );

        if (portAnalysis) {
          if (kind === "adapter") {
            content = generateAdapterFromPort(
              portAnalysis,
              name,
              relativeImportSpecifier(filePath, portAnalysis.filePath),
              filePath,
            );
          } else {
            // Resolve each out-port to its interface name + import path. Prefer
            // the ACTUAL interface from the out-port file when it already exists
            // (re-sync / hand-authored / a custom `stubs.templates.outPort` that
            // doesn't follow `{name}Port`); otherwise derive `${base}Port`, which
            // matches the generic out-port stub the same run will write (use_cases
            // emit before ports.out, so on a fresh pass the file isn't there yet).
            // The in-port interface comes from the analysis tryAnalyzeRelatedPort
            // just resolved.
            const outPortNaming = resolveNaming(
              "outPort",
              contextNaming,
              manifestNaming,
            );
            // Same resolved directory the out-port stubs are emitted into
            // (A2) — the derived import specifiers must point at the actual
            // emission site, not the conventional one.
            const outPortDir = path.join(
              moduleDir,
              resolveEmissionDir(layersConfig, "application/ports/out"),
            );
            const outPorts: UseCaseOutPort[] = (
              context.layers?.application?.ports?.out ?? []
            ).map((p) => {
              const base = normalizeStubName(portName(p), outPortNaming);
              const outFile = interpolateWithLog(
                outPortNaming,
                base,
                "stubs.naming.outPort",
                interpolation,
              );
              const outPortPath = path.join(outPortDir, outFile);
              const analyzed = analyzePortFile(outPortPath);
              return {
                interfaceName: analyzed?.interfaceName ?? `${base}Port`,
                paramName: base.charAt(0).toLowerCase() + base.slice(1),
                importSpecifier: relativeImportSpecifier(filePath, outPortPath),
              };
            });
            content = generateUseCaseFromPort(
              portAnalysis,
              name,
              outPorts,
              relativeImportSpecifier(filePath, portAnalysis.filePath),
              filePath,
            );
          }
          config.logger.debug(`Generated ${kind} '${name}' from port analysis`);
        } else {
          content = interpolateWithLog(
            contentTemplate,
            name,
            `stubs.templates.${kind}`,
            interpolation,
          );
        }
      } else {
        content = interpolateWithLog(
          contentTemplate,
          name,
          `stubs.templates.${kind}`,
          interpolation,
        );
      }

      const status = await writeStubFile(filePath, content, config, report);

      recordWriteStatus(result, filePath, status);
    }
  }

  return result;
}
