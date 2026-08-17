import type { EventBusPort } from "@hexagen/messaging";
import type {
  RemovePortInput,
  RemovePortOutput,
  RemovePortToolPort,
} from "../ports/in/remove-port-tool.port.js";
import type { ManifestWritePort } from "../ports/out/manifest-write.port.js";

export class RemovePortToolUseCase implements RemovePortToolPort {
  constructor(
    private readonly manifestWritePort: ManifestWritePort,
    private readonly eventBusPort: EventBusPort,
  ) {}

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

    const result = await this.manifestWritePort.removePort({
      contextName: input.context_name,
      portName: input.port_name,
      direction: input.direction === "inbound" ? "in" : "out",
    });

    if (!result.success) {
      throw result.error;
    }

    this.eventBusPort.publish({
      type: "PortRemoved",
      payload: {
        contextName: input.context_name,
        portName: input.port_name,
        direction: input.direction,
      },
      timestamp: Date.now(),
      source: "mcp-server",
    });

    return {
      dryRun: false,
      removed: result.value.removed,
      message: result.value.removed
        ? `Port ${input.port_name} removed from ${input.context_name}.`
        : `Port ${input.port_name} was not found in ${input.context_name}.`,
    };
  }
}
