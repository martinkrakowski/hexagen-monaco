import type { EventBusPort } from "@hexagen/messaging";
import type { SyncEnginePort } from "../ports/out/sync-engine.port.js";

export interface ScaffoldModuleInput {
  name: string;
  layer: "domain" | "application" | "infrastructure";
  dry_run?: boolean;
}

export interface ScaffoldModuleOutput {
  dryRun: boolean;
  message: string;
  filesCreated: string[];
}

export class ScaffoldModuleToolUseCase {
  constructor(
    private readonly syncEnginePort: SyncEnginePort,
    private readonly eventBusPort: EventBusPort,
  ) {}

  async execute(input: ScaffoldModuleInput): Promise<ScaffoldModuleOutput> {
    if (!input.name.trim()) {
      throw new Error("name is required");
    }

    if (input.dry_run ?? false) {
      return {
        dryRun: true,
        message: `Dry-run successful. Module ${input.name} can be scaffolded in ${input.layer}.`,
        filesCreated: [],
      };
    }

    const result = await this.syncEnginePort.scaffoldModule({
      name: input.name,
      layer: input.layer,
    });

    if (!result.success) {
      throw result.error;
    }

    this.eventBusPort.publish({
      type: "ModuleScaffolded",
      payload: {
        moduleName: input.name,
        layer: input.layer,
      },
      timestamp: Date.now(),
      source: "mcp-server",
    });

    return {
      dryRun: false,
      message: `Scaffolded module ${input.name}.`,
      filesCreated: result.value.filesCreated,
    };
  }
}
