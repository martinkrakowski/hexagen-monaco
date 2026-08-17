/**
 * Inbound (driving) port per ADR-0048: the use case implements this contract
 * and the MCP tool adapter calls it. Nothing in `infrastructure/` implements it.
 *
 * The input is declared here rather than extended from the driven
 * `AddDependencyCommand`: an inbound contract that borrows its shape from an
 * outbound one re-couples the two directions this ADR just separated.
 */
export interface AddDependencyInput {
  sourceModule: string;
  targetModule: string;
  dry_run?: boolean;
}

export interface AddDependencyOutput {
  dryRun: boolean;
  updated: boolean;
  message: string;
}

export interface AddDependencyToolPort {
  execute(input: AddDependencyInput): Promise<AddDependencyOutput>;
}
