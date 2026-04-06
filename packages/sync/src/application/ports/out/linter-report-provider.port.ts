import type { LinterReport, Result } from "@hexagen/shared";

export interface LinterReportProviderPort {
  getLinterReport(): Promise<Result<LinterReport>>;
}
