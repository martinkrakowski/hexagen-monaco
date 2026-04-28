import type { FeatureReport } from "../../../domain/index.js";
import type { FeatureId } from "../../../domain/value-objects/feature-id.js";
import type { Result } from "@hexagen/shared";

export interface ReportRepositoryPort {
  save(report: FeatureReport, projectRoot: string): Promise<Result<void>>;
  load(
    featureId: FeatureId,
    projectRoot: string,
  ): Promise<Result<FeatureReport | null>>;
  appendPhaseReport(
    featureId: FeatureId,
    phase: string,
    content: string,
    projectRoot: string,
  ): Promise<Result<void>>;
}
