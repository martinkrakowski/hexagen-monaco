import type { ArchitectureGraph, Result } from "@hexagen/shared";

export interface ArchitectureGraphProviderPort {
  getArchitectureGraph(): Promise<Result<ArchitectureGraph>>;
}
