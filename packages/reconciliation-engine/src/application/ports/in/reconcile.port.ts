import type {
  ReconciliationResult,
  StructuredLLMOutput,
  ProjectSpecLike,
  Identifier,
} from "../../../domain/llm-response.js";
import type { LinterReportLike } from "@hexagen/core-domain";

export interface ReconcileRequest {
  structuredOutput: StructuredLLMOutput;
  currentManifest: ProjectSpecLike;
  intentId: Identifier;
  linterReport?: LinterReportLike;
}

export interface ReconciliationPort {
  reconcile(request: ReconcileRequest): Promise<ReconciliationResult>;
}

export function isReconciliationPort(
  port: unknown,
): port is ReconciliationPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.reconcile === "function";
}
