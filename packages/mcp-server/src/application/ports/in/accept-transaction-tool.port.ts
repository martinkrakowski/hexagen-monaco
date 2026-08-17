import type { Transaction } from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";

/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 *
 * The driven side of this tool is `TransactionManagerPort` from
 * `@hexagen/transaction-system` — handed to the use case, implemented by
 * `InMemoryTransactionManager`, an infrastructure adapter. That contract is
 * reused as-is rather than re-declared here; the two directions are separate
 * contracts on purpose, and the tool bag must never be typed on the driven one
 * (a handler holding the manager would bypass this use case entirely).
 *
 * Like `DiffManifestToolPort` and unlike the six throw-on-error manifest
 * structure ports, this one keeps a `Result` return channel: the tool adapter
 * branches on `result.success` rather than catching. That difference is the
 * existing behaviour, preserved here.
 */
export interface AcceptTransactionToolInput {
  transaction_id: string;
  reason?: string;
}

export interface AcceptTransactionToolResult {
  transaction: Transaction;
  previous_status: string;
  new_status: string;
}

export interface AcceptTransactionToolPort {
  execute(
    input: AcceptTransactionToolInput,
  ): Promise<Result<AcceptTransactionToolResult>>;
}
