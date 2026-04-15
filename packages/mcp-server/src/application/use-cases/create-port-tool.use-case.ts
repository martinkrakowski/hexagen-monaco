import type { ManifestWritePort } from "../ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "../ports/out/scaffolding.port.js";

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
  constructor(
    private readonly scaffoldingPort: ScaffoldingPort,
    private readonly manifestWritePort: ManifestWritePort,
  ) {}

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

    const fileResult = await this.scaffoldingPort.createPort({
      domainName: input.domain_name,
      portName: input.port_name,
      type: input.type,
    });

    if (!fileResult.success) {
      throw fileResult.error;
    }

    const registerResult = await this.manifestWritePort.registerPort({
      contextName: input.domain_name,
      portName: input.port_name,
      direction: input.type === "inbound" ? "in" : "out",
    });

    if (!registerResult.success) {
      throw registerResult.error;
    }

    return {
      dryRun: false,
      fileCreated: fileResult.value.fileCreated,
      message: `Port ${input.port_name} created and registered in manifest.`,
    };
  }
}
