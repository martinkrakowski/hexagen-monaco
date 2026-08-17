import type { EventBusPort } from "@hexagen/messaging";
import type {
  AddDependencyInput,
  AddDependencyOutput,
  AddDependencyToolPort,
} from "../ports/in/add-dependency-tool.port.js";
import type { ManifestWritePort } from "../ports/out/manifest-write.port.js";

export class AddDependencyToolUseCase implements AddDependencyToolPort {
  constructor(
    private readonly manifestWritePort: ManifestWritePort,
    private readonly eventBusPort: EventBusPort,
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

    const applyResult = await this.manifestWritePort.addDependency({
      sourceModule: input.sourceModule,
      targetModule: input.targetModule,
    });

    if (!applyResult.success) {
      throw applyResult.error;
    }

    this.eventBusPort.publish({
      type: "DependencyAdded",
      payload: {
        source: input.sourceModule,
        target: input.targetModule,
        relationship: "depends_on",
      },
      timestamp: Date.now(),
      source: "mcp-server",
    });

    return {
      dryRun: false,
      updated: applyResult.value.updated,
      message: "Dependency updated.",
    };
  }
}
