/**
 * Stub Generation Use Case
 *
 * Orchestrates the stub file generation process for a bounded context.
 * Handles template resolution, naming cascade, emission planning,
 * and file emission.
 */

import path from "node:path";
import type { BoundedContext, StubsConfig, StubNaming, StubTemplates } from "../../types/manifest.js";
import type { SyncConfig } from "../../config.js";
import { createEmptyResult, type GeneratorResult } from "../../results.js";
import type { FileSystemPort } from "../ports/out/file-system.port.js";
import type { LoggerPort } from "@hexagen/shared";
import {
  buildEmissionPlan,
  type EmissionPlan,
  type EmissionSite,
  type StubKind,
} from "../../domain/services/emission-plan-builder.js";
import {
  resolveTemplate,
  resolveNaming,
  interpolateWithLog,
  type StubKind as ResolvedStubKind,
} from "../../domain/services/stub-template-resolver.js";

export interface StubGenerationOptions {
  moduleDir: string;
  moduleName: string;
  stubsConfig: StubsConfig | undefined;
  context: BoundedContext;
}

export interface StubGenerationResult {
  result: GeneratorResult;
  skippedCount: number;
}

function getStubKind(kind: string): ResolvedStubKind | null {
  const kindMap: Record<string, ResolvedStubKind> = {
    entity: "entity",
    valueObject: "valueObject",
    domainService: "domainService",
    inPort: "inPort",
    outPort: "outPort",
    adapter: "adapter",
    useCase: "useCase",
  };
  return kindMap[kind] ?? null;
}

function getEmissionSite(subdir: string): EmissionSite | null {
  const siteMap: Record<string, EmissionSite> = {
    "domain/entities": "domain/entities",
    "domain/value-objects": "domain/value-objects",
    "domain/services": "domain/services",
    "domain/ports/in": "domain/ports/in",
    "domain/ports/out": "domain/ports/out",
    "application/use-cases": "application/use-cases",
    "application/ports/in": "application/ports/in",
    "application/ports/out": "application/ports/out",
    "infrastructure/adapters": "infrastructure/adapters",
  };
  return siteMap[subdir] ?? null;
}

export async function generateStubs(
  options: StubGenerationOptions,
  fsPort: FileSystemPort,
  logger: LoggerPort,
): Promise<StubGenerationResult> {
  const { moduleDir, moduleName, stubsConfig, context } = options;
  const result = createEmptyResult();

  if (!stubsConfig || stubsConfig.enabled !== true) {
    return { result, skippedCount: 0 };
  }

  const plan = buildEmissionPlan(context);
  if (plan.length === 0) {
    logger.debug(`generateStubs: no layer declarations for '${moduleName}'`);
    return { result, skippedCount: 0 };
  }

  const manifestTemplates = stubsConfig.templates;
  const manifestNaming = stubsConfig.naming;
  const contextNaming = context.generator?.stubs?.naming;

  for (const { kind, subdir, names } of plan) {
    const resolvedKind = getStubKind(kind);
    const resolvedSubdir = getEmissionSite(subdir);
    
    if (!resolvedKind || !resolvedSubdir) {
      continue;
    }

    const contentTemplate = resolveTemplate(resolvedKind, manifestTemplates);
    const namingTemplate = resolveNaming(
      resolvedKind,
      contextNaming as StubNaming | undefined,
      manifestNaming as StubNaming | undefined,
    );

    for (const name of names) {
      const filename = interpolateWithLog(
        namingTemplate,
        name,
        `stubs.naming.${kind}`,
        { logger, workspaceRoot: "", manifest: { generator: {} } } as SyncConfig,
      );

      const content = interpolateWithLog(
        contentTemplate,
        name,
        `stubs.templates.${kind}`,
        { logger, workspaceRoot: "", manifest: { generator: {} } } as SyncConfig,
      );

      const filePath = path.join(moduleDir, "src", subdir, filename);

      if (await fsPort.exists(filePath)) {
        logger.debug(`stub preserved ${path.relative(moduleDir, filePath)}`);
        result.skipped.push(filePath);
        continue;
      }

      await fsPort.mkdir(path.dirname(filePath));
      await fsPort.writeFile(filePath, content);
      result.created.push(filePath);
      result.totalOps += 1;
    }
  }

  return { result, skippedCount: result.skipped.length };
}
