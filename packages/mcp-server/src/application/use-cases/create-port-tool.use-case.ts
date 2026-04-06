import type { SyncEnginePort } from "../ports/out/sync-engine.port.js";

export interface CreatePortInput {
  domain_name: string;
  port_name: string;
  type: "inbound" | "outbound";
  dry_run?: boolean;
}

export interface CreatePortOutput {
  dryRun: boolean;
  fileCreated?: string;
  message: string;
}

export class CreatePortToolUseCase {
  constructor(private readonly syncEnginePort: SyncEnginePort) {}

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

    const result = await this.syncEnginePort.createPort({
      domainName: input.domain_name,
      portName: input.port_name,
      type: input.type,
    });

    if (!result.success) {
      throw result.error;
    }

    return {
      dryRun: false,
      fileCreated: result.value.fileCreated,
      message: `Port ${input.port_name} created.`,
    };
  }
}
