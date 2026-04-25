import type { Identifier } from "@hexagen/shared";
import type { DomainModelId } from "../../../domain/value-objects/model-id.vo.js";
import type { ProjectSpec } from "@hexagen/project-configuration";
import type { ArchitectureGraph } from "@hexagen/visualization";
import type { LinterReport } from "@hexagen/governance";

export interface CompiledPromptRequest {
  intentId: Identifier;
  manifest: ProjectSpec;
  architectureGraph: ArchitectureGraph;
  linterReport: LinterReport;
  userIntent: string;
  modelId: DomainModelId;
  temperature?: number;
  maxTokens?: number;
}

export interface CompiledPromptAdapterPort {
  sendCompiledPrompt(request: CompiledPromptRequest): Promise<string>;
}

export function isCompiledPromptAdapterPort(
  port: unknown,
): port is CompiledPromptAdapterPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.sendCompiledPrompt === "function";
}
