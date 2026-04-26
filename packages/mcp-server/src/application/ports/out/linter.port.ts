import type { LinterReport } from "@hexagen/governance";
import type { Result } from "@hexagen/shared";

export interface LinterPort {
  auditBoundaries(): Promise<Result<LinterReport>>;
}
