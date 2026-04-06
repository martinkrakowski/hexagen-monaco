import type { LinterReport, Result } from "@hexagen/shared";

export interface LinterPort {
  auditBoundaries(): Promise<Result<LinterReport>>;
}
