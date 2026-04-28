import type { FeatureId } from "../../../domain/value-objects/feature-id.js";
import type { ReportPhase } from "../../../domain/value-objects/report-phase.js";

export interface SubmitArchitecturalSpecPort {
  execute(
    featureId: FeatureId,
    phase: ReportPhase,
    specContent: string,
    projectRoot: string,
  ): Promise<void>;
}
