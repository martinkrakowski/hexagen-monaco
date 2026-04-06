import type { LinterReport } from "@hexagen/shared";
import type { GetLinterReportResourceUseCase } from "../../application/use-cases/get-linter-report-resource.use-case.js";

export class LinterReportResourceAdapter {
  constructor(private readonly useCase: GetLinterReportResourceUseCase) {}

  async execute(): Promise<LinterReport> {
    return this.useCase.execute();
  }
}
