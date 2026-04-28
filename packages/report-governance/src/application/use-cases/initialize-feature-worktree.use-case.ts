import type { FeatureId } from "../../domain/value-objects/feature-id.js";
import type { FeatureReport } from "../../domain/index.js";
import type { Result } from "../result.js";
import type { ReportRepositoryPort } from "../ports/out/report-repository.port.js";
import { createTimestamp } from "../../domain/value-objects/timestamp.js";
import { createReportManifest } from "../../domain/value-objects/report-manifest.js";
import { createFeatureReport } from "../../domain/model/feature-report/index.js";

export class InitializeFeatureWorktreeUseCase {
  constructor(private readonly reportRepo: ReportRepositoryPort) {}

  async execute(featureId: FeatureId, projectRoot: string): Promise<Result<FeatureReport, Error>> {
    try {
      const now = createTimestamp();
      const manifest = createReportManifest(featureId, "01-blueprint", now);
      const report = createFeatureReport(featureId, "01-blueprint", manifest, now);
      const saveResult = await this.reportRepo.save(report, projectRoot);
      if (!saveResult.success) {
        return { success: false, error: saveResult.error as Error };
      }
      return { success: true, value: report };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }
}
