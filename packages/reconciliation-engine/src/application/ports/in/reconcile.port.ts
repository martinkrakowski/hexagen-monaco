import type { LLMResponse, ReconciliationResult, DomainASTLike, Identifier } from "../../../domain/llm-response.js";

export interface ReconcileRequest {
  response: LLMResponse;
  currentAST: DomainASTLike;
  intentId: Identifier;
}

export interface ReconciliationPort {
  reconcile(request: ReconcileRequest): Promise<ReconciliationResult>;
}

export function isReconciliationPort(port: unknown): port is ReconciliationPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.reconcile === "function";
}