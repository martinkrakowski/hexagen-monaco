import type { BoundedContextType } from "@hexagen/shared";

/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 *
 * The driven side of this tool is `TransactionManagerPort` from
 * `@hexagen/transaction-system` — handed to the use case, implemented by
 * `InMemoryTransactionManager`, an infrastructure adapter. That contract is
 * reused as-is rather than re-declared here; it stays outbound and is
 * deliberately absent from the handler bag (a handler holding the manager
 * would bypass this use case entirely).
 */
export interface ScaffoldModuleInput {
  name: string;
  layer: "domain" | "application" | "infrastructure";
  context_type?: BoundedContextType;
  dry_run?: boolean;
}

export interface ScaffoldModuleOutput {
  dryRun: boolean;
  message: string;
  filesCreated: string[];
  registeredInManifest: boolean;
  pendingApproval?: boolean;
  transactionId?: string;
}

export interface ScaffoldModuleToolPort {
  execute(input: ScaffoldModuleInput): Promise<ScaffoldModuleOutput>;
}
