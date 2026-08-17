import type { Transaction } from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";

/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 * The driven side stays `TransactionManagerPort` from
 * `@hexagen/transaction-system`; see `accept-transaction-tool.port.ts`.
 *
 * A miss is a *successful* query with `found: false`, not an error arm — the
 * tool adapter renders the payload either way, and only a thrown lookup failure
 * takes the `Result` error channel.
 */
export interface GetTransactionToolInput {
  transaction_id: string;
}

export interface GetTransactionToolResult {
  transaction: Transaction | null;
  found: boolean;
}

export interface GetTransactionToolPort {
  execute(
    input: GetTransactionToolInput,
  ): Promise<Result<GetTransactionToolResult>>;
}
