import type { BoundedContextType } from "@hexagen/shared";

/**
 * Architecture-graph domain types.
 *
 * These were Zod schemas until the ADR-0054 `zod` disposition (2026-08-16). The
 * only non-test consumer of the runtime schema was
 * `GetArchitectureGraphUseCase`, which called `ArchitectureGraphSchema.parse()`
 * on the value returned by `ArchitectureGraphProviderPort` — an IN-PROCESS port
 * whose implementations (`ServerArchitectureGraphProviderAdapter` in `apps/web`,
 * `SyncEngineAdapter` in mcp-server) both build the nodes and edges in
 * TypeScript from an already-parsed manifest. The manifest parsing happens
 * upstream in `@hexagen/project-configuration`, which keeps its Zod parser; by
 * the time a graph reaches this type it has crossed no untyped boundary, so the
 * parse re-validated what the type system already guaranteed.
 *
 * One behavioural note: `status` used to carry a Zod `.default("active")`. Every
 * implementation sets it explicitly, so nothing relied on the default being
 * filled in — it is now a required field, which makes that obligation visible to
 * the compiler instead of silently repaired at runtime.
 */

export interface GraphNode {
  id: string;
  label: string;
  type: BoundedContextType;
  status: "active" | "deprecated" | "planned";
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: "depends_on" | "implements" | "uses";
  isValid: boolean;
  violationReason?: string;
}

export interface ArchitectureGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
