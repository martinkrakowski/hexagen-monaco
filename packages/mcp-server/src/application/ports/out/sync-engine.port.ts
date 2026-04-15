import type { ArchitectureGraph, LinterReport, Result } from "@hexagen/shared";

export interface ArchitectureQueryPort {
  getArchitectureGraph(): Promise<Result<ArchitectureGraph>>;
  getLinterReport(): Promise<Result<LinterReport>>;
}
