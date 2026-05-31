/**
 * Outbound port for the AgentCore Gateway — exposes APIs, Lambdas, and MCP
 * servers as a single set of MCP tools behind one endpoint.
 *
 * Framework-neutral: tools surface as {@link GatewayTool} domain shapes, not MCP
 * wire types, so the agent's tool-calling layer (e.g. langgraph tool nodes) binds
 * to this port and never to the MCP client.
 */
export interface GatewayTool {
  readonly name: string;
  readonly description?: string;
  /** JSON-Schema for the tool's arguments, as advertised by the Gateway. */
  readonly inputSchema?: Record<string, unknown>;
}

export interface ToolInvocationResult {
  readonly content: string;
  /** True when the tool reported a handled error (vs. a transport failure, which throws). */
  readonly isError?: boolean;
}

export interface ToolGatewayPort {
  /** Discover the tools currently published by the Gateway. */
  listTools(): Promise<GatewayTool[]>;
  /** Invoke a tool by name with JSON arguments. */
  invokeTool(name: string, args: Record<string, unknown>): Promise<ToolInvocationResult>;
}
