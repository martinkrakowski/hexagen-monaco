import type { ToolDefinition } from "./tool-definition.js";

export const auditBoundariesTool: ToolDefinition = {
  name: "hexagen_audit_boundaries",
  description: "Runs architecture linter and returns structured report",
  inputSchema: {
    type: "object",
    properties: {
      dry_run: { type: "boolean" },
    },
  },
  handler: async (args, deps) => {
    try {
      const a = args as Record<string, unknown>;
      const result = await deps.auditBoundariesToolUseCase.execute({
        dry_run: (a.dry_run as boolean | undefined) ?? true,
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
