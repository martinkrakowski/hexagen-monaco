import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  PENDING_MANIFEST_MUTATION_KEY,
  type PendingManifestMutation,
} from "../pending-manifest-mutation.js";
import type {
  CreateAdapterInput,
  CreateAdapterOutput,
  CreateAdapterToolPort,
} from "../ports/in/create-adapter-tool.port.js";

export class CreateAdapterToolUseCase implements CreateAdapterToolPort {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(input: CreateAdapterInput): Promise<CreateAdapterOutput> {
    if (!input.port_name.trim() || !input.infrastructure_name.trim()) {
      throw new Error("port_name and infrastructure_name are required");
    }

    if (!/Port$/.test(input.port_name)) {
      throw new Error("port_name must end with 'Port' (e.g., 'PaymentPort')");
    }

    if (input.dry_run ?? false) {
      return {
        dryRun: true,
        message: `Dry-run successful. Adapter for ${input.port_name} can be created in ${input.infrastructure_name}.`,
      };
    }

    const mutation: PendingManifestMutation = {
      kind: "create-adapter",
      input,
    };
    const tx = this.transactionManager.begin(
      `mcp:create-adapter:${input.infrastructure_name}/${input.port_name}`,
      { [PENDING_MANIFEST_MUTATION_KEY]: mutation },
    );

    return {
      dryRun: false,
      pendingApproval: true,
      transactionId: tx.id,
      message: `Proposed adapter for ${input.port_name}. Accept via hexagen_accept_transaction (${tx.id}) to write the manifest.`,
    };
  }
}
