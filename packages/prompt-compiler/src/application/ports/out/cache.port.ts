import type { PromptTemplate } from "../../../domain/prompt-template";

export interface PromptCachePort {
  get(key: string): Promise<PromptTemplate | null>;
  set(key: string, template: PromptTemplate, ttlMs?: number): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
}

export function isPromptCachePort(port: unknown): port is PromptCachePort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return (
    typeof p.get === "function" &&
    typeof p.set === "function" &&
    typeof p.has === "function" &&
    typeof p.delete === "function" &&
    typeof p.clear === "function"
  );
}
