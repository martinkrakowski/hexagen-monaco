import type {
  GatewayTool,
  ToolInvocationResult,
} from "../../../domain/ports/out/tool-gateway.port";

/**
 * Maps MCP wire shapes (as published by the AgentCore Gateway) onto the
 * framework-neutral {@link GatewayTool} / {@link ToolInvocationResult} domain
 * shapes. Keeping this translation in one place means the port never leaks MCP
 * types and the adapter stays thin.
 */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpContentBlock {
  type: string;
  text?: string;
}

export interface McpCallResult {
  content?: McpContentBlock[];
  isError?: boolean;
}

export function toGatewayTool(descriptor: McpToolDescriptor): GatewayTool {
  return {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
  };
}

export function toInvocationResult(result: McpCallResult): ToolInvocationResult {
  // Concatenate text blocks; non-text content (images, resources) is dropped
  // from the string view — surface it explicitly if your tools return it.
  const content = (result.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  return { content, isError: result.isError };
}
