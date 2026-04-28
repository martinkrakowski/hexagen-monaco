import type { FeatureId } from "../../../domain/value-objects/feature-id.js";
import type { ReportPhase } from "../../../domain/value-objects/report-phase.js";

export interface LogAgentRemediationPort {
  execute(
    featureId: FeatureId,
    phase: ReportPhase,
    agentId: string,
    remediationContent: string,
    projectRoot: string,
  ): Promise<void>;
}
