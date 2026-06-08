import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import { safeWriteFileAtomic, isInScope } from "../fs-utils.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import type {
  BoundedContext,
  StubNaming,
  StubTemplates,
  StubsConfig,
} from "../types/manifest.js";
import { portName } from "../types/manifest.js";
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
import type { ReportRecorder } from "../domain/types.js";
import { interpolateWithLog } from "../domain/services/stub-template-resolver.js";

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
): Promise<"created" | "updated" | "unchanged" | "skipped" | "protected"> {
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

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  return safeWriteFileAtomic(filePath, content, config, report, false);
}

async function tryAnalyzeRelatedPort(
  moduleDir: string,
  name: string,
  kind: "adapter" | "useCase",
  context: BoundedContext,
  relatedPortNamingTemplate: string,
): Promise<ReturnType<typeof analyzePortFile>> {
  const portType = kind === "adapter" ? "out" : "in";
  const portSubdir = `application/ports/${portType}`;

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
    const portFilePath = path.join(moduleDir, "src", portSubdir, filename);
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
 * already clean PascalCase. Mirrors what `architecture-files.ts` already does.
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
  const pascal = base
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  if (pascal.length === 0) return "Stub";
  // Guarantee a valid identifier start (a digit-leading name like "3d-renderer").
  return /^[0-9]/.test(pascal) ? `Stub${pascal}` : pascal;
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

  const plan = buildEmissionPlan(context);
  if (plan.length === 0) {
    config.logger.debug(
      `generateStubs: no layer declarations for '${moduleName}'`,
    );
    return result;
  }

  const manifestTemplates = stubs.templates;
  const manifestNaming = stubs.naming;
  const contextNaming = context.generator?.stubs?.naming;

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
        config,
      );

      const filePath = path.join(moduleDir, "src", subdir, filename);
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
            const outPortDir = path.join(
              moduleDir,
              "src",
              "application",
              "ports",
              "out",
            );
            const outPorts: UseCaseOutPort[] = (
              context.layers?.application?.ports?.out ?? []
            ).map((p) => {
              const base = normalizeStubName(portName(p), outPortNaming);
              const outFile = interpolateWithLog(
                outPortNaming,
                base,
                "stubs.naming.outPort",
                config,
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
            config,
          );
        }
      } else {
        content = interpolateWithLog(
          contentTemplate,
          name,
          `stubs.templates.${kind}`,
          config,
        );
      }

      const status = await writeStubFile(filePath, content, config, report);

      if (status === "created") result.created.push(filePath);
      if (status === "updated") result.updated.push(filePath);
      if (status === "skipped" || status === "protected")
        result.skipped.push(filePath);
      if (status === "created" || status === "updated") result.totalOps += 1;
    }
  }

  return result;
}
