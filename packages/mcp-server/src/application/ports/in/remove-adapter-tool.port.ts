/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 */
export interface RemoveAdapterInput {
  context_name: string;
  adapter_name: string;
  port_name: string;
  dry_run?: boolean;
}

export interface RemoveAdapterOutput {
  dryRun: boolean;
  removed: boolean;
  message: string;
  pendingApproval?: boolean;
  transactionId?: string;
}

export interface RemoveAdapterToolPort {
  execute(input: RemoveAdapterInput): Promise<RemoveAdapterOutput>;
}
