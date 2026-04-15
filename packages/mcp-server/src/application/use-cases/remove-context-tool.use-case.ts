import type { EventBusPort } from "@hexagen/messaging";
import type { ManifestWritePort } from "../ports/out/manifest-write.port.js";

export interface RemoveContextInput {
  context_name: string;
  dry_run?: boolean;
}

export interface RemoveContextOutput {
  dryRun: boolean;
  removed: boolean;
  message: string;
}

export class RemoveContextToolUseCase {
  constructor(
    private readonly manifestWritePort: ManifestWritePort,
    private readonly eventBusPort: EventBusPort,
  ) {}

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

    const result = await this.manifestWritePort.removeContext({
      contextName: input.context_name,
    });

    if (!result.success) {
      throw result.error;
    }

    this.eventBusPort.publish({
      type: "ContextRemoved",
      payload: {
        contextName: input.context_name,
      },
      timestamp: Date.now(),
      source: "mcp-server",
    });

    return {
      dryRun: false,
      removed: result.value.removed,
      message: result.value.removed
        ? `Context ${input.context_name} removed from manifest.`
        : `Context ${input.context_name} was not found in manifest.`,
    };
  }
}
