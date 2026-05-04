import type { ToolDefinition } from "./tool-definition.js";

export const logAgentRemediationTool: ToolDefinition = {
  name: "hexagen_log_agent_remediation",
  description: "Log an agent remediation action for a feature",
  inputSchema: {
    type: "object",
    properties: {
      feature_id: { type: "string", description: "Feature identifier" },
      agent_id: { type: "string", description: "Agent identifier" },
      remediation_content: {
        type: "string",
        description: "Remediation content (markdown)",
      },
    },
    required: ["feature_id", "agent_id", "remediation_content"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.logAgentRemediationToolUseCase.execute({
      featureId: a.feature_id as string,
      agentId: a.agent_id as string,
      remediationContent: a.remediation_content as string,
    });
    if (!result.logged) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: String(result.error ?? "Unknown error"),
          },
        ],
      };
    }
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};
