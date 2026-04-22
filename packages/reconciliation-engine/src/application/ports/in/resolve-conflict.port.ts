import type { Patch } from "../../../domain/llm-response.js";

export interface ResolveConflictPort {
  resolveConflict(patchA: Patch, patchB: Patch): Patch;
}

export function isResolveConflictPort(
  port: unknown,
): port is ResolveConflictPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.resolveConflict === "function";
}
