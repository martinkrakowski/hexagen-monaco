import type { LinterReportLike } from "@hexagen/core-domain";
import type {
  ProjectSpecLike,
  ArchitectureGraphLike,
  PromptTemplate,
  RenderedPrompt,
} from "../../../domain/prompt-template";

export interface PromptCompileRequest {
  name: string;
  manifest: ProjectSpecLike;
  architectureGraph: ArchitectureGraphLike;
  linterReport: LinterReportLike;
  userIntent: string;
  templateOverrides?: Record<string, string>;
}

export interface PromptCompilerPort {
  compile(request: PromptCompileRequest): Promise<PromptTemplate>;
  render(
    template: PromptTemplate,
    overrides?: Record<string, string>,
  ): RenderedPrompt;
}

export function isPromptCompilerPort(
  port: unknown,
): port is PromptCompilerPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.compile === "function" && typeof p.render === "function";
}
