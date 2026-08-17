import type {
  Transaction,
  TransactionStatus,
} from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";

/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 * The driven side stays `TransactionManagerPort` from
 * `@hexagen/transaction-system`; see `accept-transaction-tool.port.ts`.
 *
 * `execute` takes an optional argument, matching the existing use case: an
 * unfiltered list is the no-argument call. The port declares that optionality
 * so an implementation cannot quietly make the filter mandatory.
 */
export interface ListTransactionsToolInput {
  status?: TransactionStatus;
}

export interface ListTransactionsToolResult {
  transactions: Transaction[];
  count: number;
  filtered_by_status?: TransactionStatus;
}

export interface ListTransactionsToolPort {
  execute(
    input?: ListTransactionsToolInput,
  ): Promise<Result<ListTransactionsToolResult>>;
}
