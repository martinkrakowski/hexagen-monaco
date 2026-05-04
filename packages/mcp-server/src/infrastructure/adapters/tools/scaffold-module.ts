import type { ToolDefinition } from "./tool-definition.js";

export const scaffoldModuleTool: ToolDefinition = {
  name: "hexagen_scaffold_module",
  description: "Scaffold a module for a specific layer",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      layer: {
        type: "string",
        enum: ["domain", "application", "infrastructure"],
      },
      context_type: {
        type: "string",
        enum: ["core", "supporting", "driver", "shared-kernel"],
      },
      dry_run: { type: "boolean" },
    },
    required: ["name", "layer"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.scaffoldModuleToolUseCase.execute({
      name: String(a.name ?? ""),
      layer: String(a.layer ?? "domain") as
        | "domain"
        | "application"
        | "infrastructure",
      context_type: a.context_type as
        | "core"
        | "supporting"
        | "driver"
        | "shared-kernel"
        | undefined,
      dry_run: (a.dry_run as boolean | undefined) ?? false,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};
