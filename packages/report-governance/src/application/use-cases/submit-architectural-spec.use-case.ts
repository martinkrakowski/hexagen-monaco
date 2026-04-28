import type { FeatureId } from "../../domain/value-objects/feature-id.js";
import type { Result } from "../result.js";
import type { ReportRepositoryPort } from "../ports/out/report-repository.port.js";
import { nextPhase } from "../../domain/value-objects/report-phase.js";
import { createTimestamp } from "../../domain/value-objects/timestamp.js";
import { advancePhase } from "../../domain/model/feature-report/index.js";
import { FeatureReportNotFoundError, InvalidPhaseTransitionError } from "../../domain/index.js";
import { featureIdValue } from "../../domain/value-objects/feature-id.js";

export class SubmitArchitecturalSpecUseCase {
  constructor(private readonly reportRepo: ReportRepositoryPort) {}

  async execute(featureId: FeatureId, specContent: string, projectRoot: string): Promise<Result<void, Error>> {
    try {
      const loadResult = await this.reportRepo.load(featureId, projectRoot);
      if (!loadResult.success) {
        return { success: false, error: loadResult.error as Error };
      }
      const report = loadResult.value;
      if (!report) {
        return { success: false, error: new FeatureReportNotFoundError(featureIdValue(featureId)) };
      }
      if (report.currentPhase !== "01-blueprint") {
        return { success: false, error: new Error("Current phase is not 01-blueprint") };
      }
      const appendResult = await this.reportRepo.appendPhaseReport(featureId, "01-blueprint", specContent, projectRoot);
      if (!appendResult.success) {
        return { success: false, error: appendResult.error as Error };
      }
      const next = nextPhase(report.currentPhase);
      if (!next) {
        return { success: false, error: new Error("No next phase available") };
      }
      const now = createTimestamp();
      const updatedReport = advancePhase(report, next, now);
      const saveResult = await this.reportRepo.save(updatedReport, projectRoot);
      if (!saveResult.success) {
        return { success: false, error: saveResult.error as Error };
      }
      return { success: true, value: undefined };
    } catch (err) {
      if (err instanceof InvalidPhaseTransitionError) {
        return { success: false, error: err };
      }
      return { success: false, error: err as Error };
    }
  }
}
