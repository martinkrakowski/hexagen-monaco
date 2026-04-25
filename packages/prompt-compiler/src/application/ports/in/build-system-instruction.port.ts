import type { Identifier } from "@hexagen/core-domain";
import type {
  ProjectSpecLike,
  ArchitectureGraphLike,
  LinterReportLike,
} from "../../../domain/prompt-template";
import type { SystemInstruction } from "../../../domain/index.js";

export interface BuildSystemInstructionRequest {
  name: string;
  manifest: ProjectSpecLike;
  architectureGraph: ArchitectureGraphLike;
  linterReport: LinterReportLike;
  templateOverrides?: Record<string, string>;
}

export interface BuildSystemInstructionPort {
  build(request: BuildSystemInstructionRequest): Promise<SystemInstruction>;
}

export function isBuildSystemInstructionPort(
  port: unknown,
): port is BuildSystemInstructionPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.build === "function";
}
