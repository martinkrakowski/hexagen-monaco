import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  PENDING_MANIFEST_MUTATION_KEY,
  type PendingManifestMutation,
} from "../pending-manifest-mutation.js";
import type {
  RemoveContextInput,
  RemoveContextOutput,
  RemoveContextToolPort,
} from "../ports/in/remove-context-tool.port.js";

export class RemoveContextToolUseCase implements RemoveContextToolPort {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(input: RemoveContextInput): Promise<RemoveContextOutput> {
    if (!input.context_name.trim()) {
      throw new Error("context_name is required");
    }

    if (input.dry_run ?? false) {
      return {
        dryRun: true,
        removed: false,
        message: `Dry-run successful. Context ${input.context_name} can be removed.`,
      };
    }

    const mutation: PendingManifestMutation = {
      kind: "remove-context",
      input,
    };
    const tx = this.transactionManager.begin(
      `mcp:remove-context:${input.context_name}`,
      { [PENDING_MANIFEST_MUTATION_KEY]: mutation },
    );

    return {
      dryRun: false,
      removed: false,
      pendingApproval: true,
      transactionId: tx.id,
      message: `Proposed removal of context ${input.context_name}. Accept via hexagen_accept_transaction (${tx.id}) to write the manifest.`,
    };
  }
}
