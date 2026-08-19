import type { BoundedContextType } from "@hexagen/shared";

/**
 * Project-governance snapshot used to ground a system prompt.
 */
export interface GovernancePayload {
  system: string;
  scope: string;
  architecture: string;
  boundedContexts: Array<{
    name: string;
    type: BoundedContextType;
  }>;
  ports: Record<string, string>;
  invariants: Array<{
    name: string;
    priority: "critical" | "high" | "medium";
  }>;
  timestamp: string;
}
