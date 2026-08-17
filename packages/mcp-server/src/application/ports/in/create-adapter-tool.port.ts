/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 */
export interface CreateAdapterInput {
  port_name: string;
  infrastructure_name: string;
  dry_run?: boolean;
}

export interface CreateAdapterOutput {
  dryRun: boolean;
  fileCreated?: string;
  message: string;
}

export interface CreateAdapterToolPort {
  execute(input: CreateAdapterInput): Promise<CreateAdapterOutput>;
}
