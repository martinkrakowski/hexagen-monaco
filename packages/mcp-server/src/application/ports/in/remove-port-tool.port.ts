/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 */
export interface RemovePortInput {
  context_name: string;
  port_name: string;
  direction: "inbound" | "outbound";
  dry_run?: boolean;
}

export interface RemovePortOutput {
  dryRun: boolean;
  removed: boolean;
  message: string;
  pendingApproval?: boolean;
  transactionId?: string;
}

export interface RemovePortToolPort {
  execute(input: RemovePortInput): Promise<RemovePortOutput>;
}
