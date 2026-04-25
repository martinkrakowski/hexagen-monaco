import { LinterReportSchema, type LinterReport } from "@hexagen/governance";
import type { LinterReportProviderPort } from "../ports/out/linter-report-provider.port.js";

export class GetLinterReportUseCase {
  constructor(private readonly provider: LinterReportProviderPort) {}

  async execute(): Promise<LinterReport> {
    const result = await this.provider.getLinterReport();
    if (!result.success) {
      throw result.error;
    }

    return LinterReportSchema.parse(result.value);
  }
}
