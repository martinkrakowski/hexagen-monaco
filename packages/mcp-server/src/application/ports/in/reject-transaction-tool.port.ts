import type { Transaction } from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";

/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 * The driven side stays `TransactionManagerPort` from
 * `@hexagen/transaction-system`; see `accept-transaction-tool.port.ts`.
 *
 * `reason` is optional on the way in and always present on the way out: the use
 * case supplies the default it records against the rollback, so a caller that
 * omitted one still learns which reason was written.
 */
export interface RejectTransactionToolInput {
  transaction_id: string;
  reason?: string;
}

export interface RejectTransactionToolResult {
  transaction: Transaction;
  previous_status: string;
  new_status: string;
  reason: string;
}

export interface RejectTransactionToolPort {
  execute(
    input: RejectTransactionToolInput,
  ): Promise<Result<RejectTransactionToolResult>>;
}
