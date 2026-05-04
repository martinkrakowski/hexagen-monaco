import type { ToolDefinition } from "./tool-definition.js";

export const generateManifestPipelineTool: ToolDefinition = {
  name: "hexagen_generate_manifest_pipeline",
  description:
    "Full pipeline: generate topology, enrich with adapters, validate, render YAML, and register contexts",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Natural language project description",
      },
      max_retries: {
        type: "number",
        description: "Maximum retry attempts per phase (default: 2)",
      },
      dry_run: {
        type: "boolean",
        description: "If true, validate and render without writing to manifest",
      },
    },
    required: ["description"],
  },
  handler: async (args, deps, signal) => {
    try {
      const a = args as Record<string, unknown>;
      const result = await deps.generateManifestPipelineToolUseCase.execute({
        description: a.description as string,
        maxRetries: a.max_retries as number | undefined,
        dryRun: a.dry_run as boolean | undefined,
        signal,
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
