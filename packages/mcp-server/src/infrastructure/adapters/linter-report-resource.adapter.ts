import type { LinterReport } from "@hexagen/shared";
import { GetLinterReportResourceUseCase } from "../../application/use-cases/get-linter-report-resource.use-case.js";

export class LinterReportResourceAdapter {
  constructor(private readonly useCase: GetLinterReportResourceUseCase) {}

  async getReport(): Promise<LinterReport> {
    const result = await this.useCase.execute();
    if (!result.success) {
      throw result.error;
    }
    return result.value;
  }
}
