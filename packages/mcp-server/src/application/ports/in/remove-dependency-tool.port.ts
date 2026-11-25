/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 */
export interface RemoveDependencyInput {
  source_module: string;
  target_module: string;
  dry_run?: boolean;
}

export interface RemoveDependencyOutput {
  dryRun: boolean;
  removed: boolean;
  message: string;
  pendingApproval?: boolean;
  transactionId?: string;
}

export interface RemoveDependencyToolPort {
  execute(input: RemoveDependencyInput): Promise<RemoveDependencyOutput>;
}
