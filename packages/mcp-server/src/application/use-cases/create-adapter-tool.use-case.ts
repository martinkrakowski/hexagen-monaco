import type { SyncEnginePort } from "../ports/out/sync-engine.port.js";

export interface CreateAdapterInput {
  port_name: string;
  infrastructure_name: string;
  dry_run?: boolean;
}

export interface CreateAdapterOutput {
  dryRun: boolean;
  fileCreated?: string;
  message: string;
}

export class CreateAdapterToolUseCase {
  constructor(private readonly syncEnginePort: SyncEnginePort) {}

  async execute(input: CreateAdapterInput): Promise<CreateAdapterOutput> {
    if (!input.port_name.trim() || !input.infrastructure_name.trim()) {
      throw new Error("port_name and infrastructure_name are required");
    }

    if (input.dry_run ?? false) {
      return {
        dryRun: true,
        message: `Dry-run successful. Adapter for ${input.port_name} can be created in ${input.infrastructure_name}.`,
      };
    }

    const result = await this.syncEnginePort.createAdapter({
      portName: input.port_name,
      infrastructureName: input.infrastructure_name,
    });

    if (!result.success) {
      throw result.error;
    }

    return {
      dryRun: false,
      fileCreated: result.value.fileCreated,
      message: `Adapter for ${input.port_name} created.`,
    };
  }
}
