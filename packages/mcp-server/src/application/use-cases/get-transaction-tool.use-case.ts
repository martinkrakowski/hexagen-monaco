import type { TransactionManagerPort } from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";
import type {
  GetTransactionToolInput,
  GetTransactionToolPort,
  GetTransactionToolResult,
} from "../ports/in/get-transaction-tool.port.js";

/**
 * GetTransactionToolUseCase — Query transaction state via MCP
 *
 * Allows AI agents to inspect transaction status, metadata, and patches
 * before deciding whether to accept or reject.
 *
 * ADR-0048: implements the inbound `GetTransactionToolPort` the MCP handler
 * calls; is handed the outbound `TransactionManagerPort` an infrastructure
 * adapter implements.
 */
export class GetTransactionToolUseCase implements GetTransactionToolPort {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(
    input: GetTransactionToolInput,
  ): Promise<Result<GetTransactionToolResult>> {
    try {
      const transaction = this.transactionManager.get(input.transaction_id);

      return {
        success: true,
        value: {
          transaction,
          found: transaction !== null,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error as Error,
      };
    }
  }
}

// Made with Bob
