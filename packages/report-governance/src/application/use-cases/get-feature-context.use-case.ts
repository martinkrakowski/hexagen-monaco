import type { FeatureId } from "../../domain/value-objects/feature-id.js";
import type { FeatureReport } from "../../domain/index.js";
import type { Result } from "../result.js";
import type { ReportRepositoryPort } from "../ports/out/report-repository.port.js";

export class GetFeatureContextUseCase {
  constructor(private readonly reportRepo: ReportRepositoryPort) {}

  async execute(featureId: FeatureId, projectRoot: string): Promise<Result<FeatureReport | null, Error>> {
    try {
      const result = await this.reportRepo.load(featureId, projectRoot);
      if (result.success) {
        return { success: true, value: result.value };
      }
      return { success: false, error: result.error as Error };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }
}
