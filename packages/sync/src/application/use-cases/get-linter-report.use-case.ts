import type { LinterReport } from "@hexagen/governance";
import type { LinterReportProviderPort } from "../ports/out/linter-report-provider.port.js";

export class GetLinterReportUseCase {
  constructor(private readonly provider: LinterReportProviderPort) {}

  async execute(): Promise<LinterReport> {
    const result = await this.provider.getLinterReport();
    if (!result.success) {
      throw result.error;
    }

    // No re-validation here by design (ADR-0054 zod disposition, 2026-08-16):
    // `LinterReportProviderPort` is an in-process port and every implementation
    // constructs the report in TypeScript. Parsing it again would re-check what
    // the type system already guarantees. A provider that ever reads a report
    // from disk or the wire must parse at ITS own boundary.
    return result.value;
  }
}
