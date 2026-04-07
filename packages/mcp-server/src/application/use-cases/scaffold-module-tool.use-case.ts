import type { EventBusPort } from "@hexagen/messaging";
import type { ManifestWritePort } from "../ports/out/manifest-write.port.js";
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
  registeredInManifest: boolean;
}

export class ScaffoldModuleToolUseCase {
  constructor(
    private readonly syncEnginePort: SyncEnginePort,
    private readonly manifestWritePort: ManifestWritePort,
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
        registeredInManifest: false,
      };
    }

    const scaffoldResult = await this.syncEnginePort.scaffoldModule({
      name: input.name,
      layer: input.layer,
    });

    if (!scaffoldResult.success) {
      throw scaffoldResult.error;
    }

    const registerResult = await this.manifestWritePort.registerBoundedContext({
      name: input.name,
      type: "core",
    });

    if (!registerResult.success) {
      throw registerResult.error;
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

    const { filesCreated } = scaffoldResult.value;
    const { registered, alreadyExisted } = registerResult.value;

    const manifestNote = alreadyExisted
      ? " (already in manifest)"
      : registered
        ? " and registered in manifest"
        : "";

    return {
      dryRun: false,
      message: `Scaffolded module ${input.name}${manifestNote}.`,
      filesCreated,
      registeredInManifest: registered,
    };
  }
}
