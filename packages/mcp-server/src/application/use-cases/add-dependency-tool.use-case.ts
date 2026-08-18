import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  PENDING_MANIFEST_MUTATION_KEY,
  type PendingManifestMutation,
} from "../pending-manifest-mutation.js";
import type {
  AddDependencyInput,
  AddDependencyOutput,
  AddDependencyToolPort,
} from "../ports/in/add-dependency-tool.port.js";
import type { ManifestWritePort } from "../ports/out/manifest-write.port.js";

export class AddDependencyToolUseCase implements AddDependencyToolPort {
  constructor(
    private readonly manifestWritePort: ManifestWritePort,
    private readonly transactionManager: TransactionManagerPort,
  ) {}

  async execute(input: AddDependencyInput): Promise<AddDependencyOutput> {
    const validation = await this.manifestWritePort.validateDependency({
      sourceModule: input.sourceModule,
      targetModule: input.targetModule,
    });

    if (!validation.success) {
      throw validation.error;
    }

    if (!validation.value.valid) {
      throw new Error(validation.value.errors.join("; "));
    }

    if (input.dry_run ?? false) {
      return {
        dryRun: true,
        updated: false,
        message: "Dry-run successful. Dependency change is valid.",
      };
    }

    const mutation: PendingManifestMutation = {
      kind: "add-dependency",
      input,
    };
    const tx = this.transactionManager.begin(
      `mcp:add-dependency:${input.sourceModule}->${input.targetModule}`,
      { [PENDING_MANIFEST_MUTATION_KEY]: mutation },
    );

    return {
      dryRun: false,
      updated: false,
      pendingApproval: true,
      transactionId: tx.id,
      message: `Proposed dependency. Accept via hexagen_accept_transaction (${tx.id}) to write the manifest.`,
    };
  }
}
