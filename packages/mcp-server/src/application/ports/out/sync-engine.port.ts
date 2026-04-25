import type { ArchitectureGraph } from "@hexagen/visualization";
import type { LinterReport } from "@hexagen/governance";
import type { Result } from "@hexagen/shared";

export interface ArchitectureQueryPort {
  getArchitectureGraph(): Promise<Result<ArchitectureGraph>>;
  getLinterReport(): Promise<Result<LinterReport>>;
}
