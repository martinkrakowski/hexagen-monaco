/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 */
export interface CreatePortInput {
  domain_name: string;
  port_name: string;
  type: "inbound" | "outbound";
  dry_run?: boolean;
}

export interface CreatePortOutput {
  dryRun: boolean;
  fileCreated?: string;
  message: string;
  pendingApproval?: boolean;
  transactionId?: string;
}

export interface CreatePortToolPort {
  execute(input: CreatePortInput): Promise<CreatePortOutput>;
}
