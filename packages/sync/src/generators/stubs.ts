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
import {
  analyzePortFile,
  generateAdapterFromPort,
  generateUseCaseFromPort,
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

  const portName = name.replace(/Adapter$|UseCase$/, "Port");

  const declaredPorts =
    portType === "in"
      ? context.layers?.application?.ports?.in || []
      : context.layers?.application?.ports?.out || [];

  if (!declaredPorts.includes(portName)) {
    return null;
  }

  const possibleFilenames = [
    `${portName}.${portType}-port.ts`,
    `${portName.toLowerCase()}.${portType}-port.ts`,
    `${portName}.ts`,
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

    for (const name of names) {
      const filename = interpolateWithLog(
        namingTemplate,
        name,
        `stubs.naming.${kind}`,
        config,
      );

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
            content = generateAdapterFromPort(portAnalysis, name);
          } else {
            const outPorts = context.layers?.application?.ports?.out || [];
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

      const filePath = path.join(moduleDir, "src", subdir, filename);
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
