import type { LinterReport } from "@hexagen/governance";
import type { Result } from "@hexagen/shared";

export interface LinterReportProviderPort {
  getLinterReport(): Promise<Result<LinterReport>>;
}
