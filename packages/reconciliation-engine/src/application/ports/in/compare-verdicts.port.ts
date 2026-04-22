import type { Verdict } from "../../../domain/verdict.js";

export interface CompareVerdictsPort {
  compareVerdicts(a: Verdict, b: Verdict): number; // -1 if a<b, 0 if equal, 1 if a>b
}

export function isCompareVerdictsPort(
  port: unknown,
): port is CompareVerdictsPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.compareVerdicts === "function";
}
