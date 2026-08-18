import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  PENDING_MANIFEST_MUTATION_KEY,
  type PendingManifestMutation,
} from "../pending-manifest-mutation.js";
import type {
  CreatePortInput,
  CreatePortOutput,
  CreatePortToolPort,
} from "../ports/in/create-port-tool.port.js";

export class CreatePortToolUseCase implements CreatePortToolPort {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(input: CreatePortInput): Promise<CreatePortOutput> {
    if (!input.domain_name.trim() || !input.port_name.trim()) {
      throw new Error("domain_name and port_name are required");
    }

    if (input.dry_run ?? false) {
      return {
        dryRun: true,
        message: `Dry-run successful. Port ${input.port_name} can be created in ${input.domain_name}.`,
      };
    }

    const mutation: PendingManifestMutation = {
      kind: "create-port",
      input,
    };
    const tx = this.transactionManager.begin(
      `mcp:create-port:${input.domain_name}/${input.port_name}`,
      { [PENDING_MANIFEST_MUTATION_KEY]: mutation },
    );

    return {
      dryRun: false,
      pendingApproval: true,
      transactionId: tx.id,
      message: `Proposed port ${input.port_name}. Accept via hexagen_accept_transaction (${tx.id}) to write the manifest.`,
    };
  }
}
