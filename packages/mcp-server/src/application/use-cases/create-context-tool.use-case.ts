import type { EventBusPort } from "@hexagen/messaging";
import { BOUNDED_CONTEXT_TYPES } from "@hexagen/shared";
import type {
  CreateContextInput,
  CreateContextOutput,
  CreateContextToolPort,
} from "../ports/in/create-context-tool.port.js";
import type {
  ManifestWritePort,
  RegisterBoundedContextCommand,
} from "../ports/out/manifest-write.port.js";

function validateContextName(name: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!name.trim()) {
    errors.push("name is required");
  } else if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    errors.push("name must be lowercase kebab-case (e.g., 'user-management')");
  } else if (name.length < 3) {
    errors.push("name must be at least 3 characters");
  } else if (name.length > 50) {
    errors.push("name must be less than 50 characters");
  }

  const reserved = ["shared", "core", "root", "system"];
  if (reserved.includes(name.toLowerCase())) {
    errors.push(`cannot use reserved name '${name}'`);
  }

  return { valid: errors.length === 0, errors };
}

export class CreateContextToolUseCase implements CreateContextToolPort {
  constructor(
    private readonly manifestWritePort: ManifestWritePort,
    private readonly eventBusPort: EventBusPort,
  ) {}

  async execute(input: CreateContextInput): Promise<CreateContextOutput> {
    if (
      !input.type ||
      !(BOUNDED_CONTEXT_TYPES as readonly string[]).includes(input.type)
    ) {
      throw new Error(
        `type must be one of: ${BOUNDED_CONTEXT_TYPES.join(", ")}`,
      );
    }

    const nameValidation = validateContextName(input.name);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.errors.join("; "));
    }

    const command: RegisterBoundedContextCommand = {
      name: input.name,
      type: input.type,
      description: input.description,
    };

    if (input.dry_run ?? false) {
      return {
        dryRun: true,
        registered: false,
        alreadyExisted: false,
        message: `Dry-run successful. Context '${input.name}' can be created as ${input.type}.`,
      };
    }

    const registerResult =
      await this.manifestWritePort.registerBoundedContext(command);

    if (!registerResult.success) {
      throw registerResult.error;
    }

    const { registered, alreadyExisted } = registerResult.value;

    if (registered) {
      this.eventBusPort.publish({
        type: "ContextCreated",
        payload: {
          contextName: input.name,
          contextType: input.type,
        },
        timestamp: Date.now(),
        source: "mcp-server",
      });
    }

    return {
      dryRun: false,
      registered,
      alreadyExisted,
      message: alreadyExisted
        ? `Context '${input.name}' already exists.`
        : `Context '${input.name}' created with ${input.type} type.`,
    };
  }
}
