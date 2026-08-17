import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  PENDING_MANIFEST_MUTATION_KEY,
  type PendingManifestMutation,
} from "../pending-manifest-mutation.js";
import type {
  RemovePortInput,
  RemovePortOutput,
  RemovePortToolPort,
} from "../ports/in/remove-port-tool.port.js";

export class RemovePortToolUseCase implements RemovePortToolPort {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(input: RemovePortInput): Promise<RemovePortOutput> {
    if (!input.context_name.trim() || !input.port_name.trim()) {
      throw new Error("context_name and port_name are required");
    }

    if (input.dry_run ?? false) {
      return {
        dryRun: true,
        removed: false,
        message: `Dry-run successful. Port ${input.port_name} can be removed from ${input.context_name}.`,
      };
    }

    const mutation: PendingManifestMutation = {
      kind: "remove-port",
      input,
    };
    const tx = this.transactionManager.begin(
      `mcp:remove-port:${input.context_name}/${input.port_name}`,
      { [PENDING_MANIFEST_MUTATION_KEY]: mutation },
    );

    return {
      dryRun: false,
      removed: false,
      pendingApproval: true,
      transactionId: tx.id,
      message: `Proposed removal of port ${input.port_name}. Accept via hexagen_accept_transaction (${tx.id}) to write the manifest.`,
    };
  }
}
