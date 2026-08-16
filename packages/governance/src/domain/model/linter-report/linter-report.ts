/**
 * Linter-report domain types.
 *
 * These were Zod schemas until the ADR-0054 `zod` disposition (2026-08-16). The
 * only non-test consumer of the runtime schema was
 * `GetLinterReportUseCase`, which called `LinterReportSchema.parse()` on the
 * value returned by `LinterReportProviderPort` — an IN-PROCESS port whose every
 * implementation builds the object literal in TypeScript
 * (`ServerLinterReportProviderAdapter` in `apps/web`, and the mcp-server
 * adapter). There is no deserialization boundary anywhere on that path, so the
 * parse re-validated what the type system already guaranteed and its only
 * effect was to pull an npm package into this domain.
 *
 * If a caller is ever added that reads a linter report from disk or the wire,
 * the parser belongs in THAT adapter, not here.
 */

export interface BoundaryViolation {
  ruleId: string;
  severity: "error" | "warning";
  file: string;
  message: string;
  snippet?: string;
}

export interface DependencyEvent {
  source: string;
  target: string;
  relationship: "depends_on" | "implements" | "uses";
}

export interface LinterReport {
  /** ISO-8601 timestamp. */
  timestamp: string;
  isCompliant: boolean;
  violations: BoundaryViolation[];
  scannedFilesCount: number;
}

export interface ArchitecturalEvent {
  /** UUID. */
  eventId: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  type: "BoundaryViolated" | "DependencyAdded" | "ModuleScaffolded";
  payload: Record<string, unknown>;
}
