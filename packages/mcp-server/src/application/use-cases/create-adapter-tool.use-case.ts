import type { ManifestWritePort } from "../ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "../ports/out/scaffolding.port.js";

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
  constructor(
    private readonly scaffoldingPort: ScaffoldingPort,
    private readonly manifestWritePort: ManifestWritePort,
  ) {}

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

    const fileResult = await this.scaffoldingPort.createAdapter({
      portName: input.port_name,
      infrastructureName: input.infrastructure_name,
    });

    if (!fileResult.success) {
      throw fileResult.error;
    }

    const registerResult = await this.manifestWritePort.registerAdapter({
      contextName: input.infrastructure_name,
      adapterName: input.port_name.replace(/Port$/, "") + "Adapter",
      portName: input.port_name,
    });

    if (!registerResult.success) {
      throw registerResult.error;
    }

    return {
      dryRun: false,
      fileCreated: fileResult.value.fileCreated,
      message: `Adapter for ${input.port_name} created and registered in manifest.`,
    };
  }
}
