import type { FeatureId } from "../../domain/value-objects/feature-id.js";
import type { Result } from "../result.js";
import type { ReportRepositoryPort } from "../ports/out/report-repository.port.js";
import { FeatureReportNotFoundError } from "../../domain/index.js";
import { featureIdValue } from "../../domain/value-objects/feature-id.js";

export class LogAgentRemediationUseCase {
  constructor(private readonly reportRepo: ReportRepositoryPort) {}

  async execute(featureId: FeatureId, agentId: string, content: string, projectRoot: string): Promise<Result<void, Error>> {
    try {
      const loadResult = await this.reportRepo.load(featureId, projectRoot);
      if (!loadResult.success) {
        return { success: false, error: loadResult.error as Error };
      }
      const report = loadResult.value;
      if (!report) {
        return { success: false, error: new FeatureReportNotFoundError(featureIdValue(featureId)) };
      }
      const formatted = `---\nagent: ${agentId}\ntimestamp: ${Date.now()}\n---\n\n${content}`;
      const appendResult = await this.reportRepo.appendPhaseReport(featureId, "04-remediation", formatted, projectRoot);
      if (!appendResult.success) {
        return { success: false, error: appendResult.error as Error };
      }
      return { success: true, value: undefined };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }
}
