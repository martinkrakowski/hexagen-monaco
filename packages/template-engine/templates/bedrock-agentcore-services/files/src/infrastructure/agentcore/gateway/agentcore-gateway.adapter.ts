// @hexagen-server-only
import type {
  GatewayTool,
  ToolGatewayPort,
  ToolInvocationResult,
} from "../../../domain/ports/out/tool-gateway.port";
import {
  toGatewayTool,
  toInvocationResult,
  type McpCallResult,
  type McpToolDescriptor,
} from "./mcp-tool-mapper";

/** Async bearer-token provider — wire AgentIdentityPort.getWorkloadToken here. */
export type TokenProvider = () => Promise<string | undefined>;

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

/**
 * AgentCore Gateway adapter — a minimal MCP-over-HTTP (Streamable HTTP) client
 * implementing {@link ToolGatewayPort} with `fetch` and no extra dependencies.
 *
 * It issues plain JSON-RPC `tools/list` / `tools/call` POSTs and reads a JSON
 * response. This is enough for Gateways that accept stateless calls; if yours
 * requires the full MCP `initialize` handshake or SSE streaming, swap this for
 * the official `@modelcontextprotocol/sdk` client behind the same port — the
 * application layer won't change.
 */
export class AgentCoreGatewayAdapter implements ToolGatewayPort {
  private readonly endpoint: string;
  private readonly getToken?: TokenProvider;
  private requestId = 0;

  constructor(endpoint?: string, getToken?: TokenProvider) {
    const resolved = endpoint ?? process.env.AGENTCORE_GATEWAY_URL;
    if (!resolved) {
      throw new Error(
        "AGENTCORE_GATEWAY_URL is not set — run `agentcore add gateway` then copy the url " +
          "from `agentcore status` into .env.local.",
      );
    }
    this.endpoint = resolved;
    this.getToken = getToken;
  }

  async listTools(): Promise<GatewayTool[]> {
    const result = await this.rpc<{ tools: McpToolDescriptor[] }>("tools/list", {});
    return (result.tools ?? []).map(toGatewayTool);
  }

  async invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolInvocationResult> {
    const result = await this.rpc<McpCallResult>("tools/call", {
      name,
      arguments: args,
    });
    return toInvocationResult(result);
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      // MCP Streamable HTTP servers may reply with JSON or an SSE stream.
      accept: "application/json, text/event-stream",
    };
    const token = await this.getToken?.();
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.requestId,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `AgentCore Gateway ${method} failed: ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as JsonRpcResponse<T>;
    if (body.error) {
      throw new Error(`AgentCore Gateway ${method} error: ${body.error.message}`);
    }
    if (body.result === undefined) {
      throw new Error(`AgentCore Gateway ${method} returned no result`);
    }
    return body.result;
  }
}
