/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 */
export interface RemoveContextInput {
  context_name: string;
  dry_run?: boolean;
}

export interface RemoveContextOutput {
  dryRun: boolean;
  removed: boolean;
  message: string;
  pendingApproval?: boolean;
  transactionId?: string;
}

export interface RemoveContextToolPort {
  execute(input: RemoveContextInput): Promise<RemoveContextOutput>;
}
