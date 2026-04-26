import type {
  ReconciliationResult,
  StructuredLLMOutput,
  ProjectSpecLike,
  Identifier,
} from "../../../domain/llm-response.js";

export interface ReconcileRequest {
  structuredOutput: StructuredLLMOutput;
  currentManifest: ProjectSpecLike;
  intentId: Identifier;
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
