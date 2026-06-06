import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
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
): Promise<ReturnType<typeof analyzePortFile>> {
  const portType = kind === "adapter" ? "out" : "in";
  const portSubdir = `application/ports/${portType}`;

  const derivedPortName = name.replace(/Adapter$|UseCase$/, "Port");

  const declaredPorts =
    portType === "in"
      ? context.layers?.application?.ports?.in || []
      : context.layers?.application?.ports?.out || [];

  if (!declaredPorts.some((p) => portName(p) === derivedPortName)) {
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
        const portAnalysis = await tryAnalyzeRelatedPort(
          moduleDir,
          name,
          kind,
          context,
        );

        if (portAnalysis) {
          if (kind === "adapter") {
            content = generateAdapterFromPort(
              portAnalysis,
              name,
              relativeImportSpecifier(filePath, portAnalysis.filePath),
            );
          } else {
            const outPorts =
              context.layers?.application?.ports?.out?.map(portName) || [];
            content = generateUseCaseFromPort(portAnalysis, name, outPorts);
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
