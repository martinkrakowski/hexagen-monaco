import {
  BOUNDED_CONTEXT_TYPES,
  type BoundedContextType,
} from "@hexagen/shared";
import type { ToolDefinition } from "./tool-definition.js";

export const createContextTool: ToolDefinition = {
  name: "hexagen_create_context",
  description: "Create a new bounded context in the manifest",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      type: {
        type: "string",
        enum: [...BOUNDED_CONTEXT_TYPES],
      },
      description: { type: "string" },
      dry_run: { type: "boolean" },
    },
    required: ["name", "type"],
  },
  handler: async (args, deps) => {
    try {
      const a = args as Record<string, unknown>;
      const result = await deps.createContextToolUseCase.execute({
        name: String(a.name ?? ""),
        type: String(a.type ?? "core") as BoundedContextType,
        description: a.description as string | undefined,
        dry_run: (a.dry_run as boolean | undefined) ?? false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  },
};
