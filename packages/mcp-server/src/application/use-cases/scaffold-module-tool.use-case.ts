import type { BoundedContextType } from "@hexagen/shared";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  PENDING_MANIFEST_MUTATION_KEY,
  type PendingManifestMutation,
} from "../pending-manifest-mutation.js";

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

export class ScaffoldModuleToolUseCase {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(input: ScaffoldModuleInput): Promise<ScaffoldModuleOutput> {
    if (!input.name.trim()) {
      throw new Error("name is required");
    }

    if (input.dry_run ?? false) {
      return {
        dryRun: true,
        message: `Dry-run successful. Module ${input.name} can be scaffolded in ${input.layer}.`,
        filesCreated: [],
        registeredInManifest: false,
      };
    }

    const mutation: PendingManifestMutation = {
      kind: "scaffold-module",
      input,
    };
    const tx = this.transactionManager.begin(
      `mcp:scaffold-module:${input.name}`,
      {
        [PENDING_MANIFEST_MUTATION_KEY]: mutation,
      },
    );

    return {
      dryRun: false,
      message: `Proposed scaffold of module ${input.name}. Accept via hexagen_accept_transaction (${tx.id}) to write the manifest.`,
      filesCreated: [],
      registeredInManifest: false,
      pendingApproval: true,
      transactionId: tx.id,
    };
  }
}
