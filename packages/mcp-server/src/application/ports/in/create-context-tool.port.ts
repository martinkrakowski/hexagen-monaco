import type { BoundedContextType } from "@hexagen/shared";

/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 */
export interface CreateContextInput {
  name: string;
  type: BoundedContextType;
  description?: string;
  dry_run?: boolean;
}

export interface CreateContextOutput {
  dryRun: boolean;
  registered: boolean;
  alreadyExisted: boolean;
  message: string;
  pendingApproval?: boolean;
  transactionId?: string;
}

export interface CreateContextToolPort {
  execute(input: CreateContextInput): Promise<CreateContextOutput>;
}
