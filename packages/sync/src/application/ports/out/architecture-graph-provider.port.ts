import type { ArchitectureGraph } from "@hexagen/visualization";
import type { Result } from "@hexagen/shared";

export interface ArchitectureGraphProviderPort {
  getArchitectureGraph(): Promise<Result<ArchitectureGraph>>;
}
