import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface MCPToolCallInput {
  name: string;
  arguments?: Record<string, unknown>;
}

export class MCPClientService {
  private client: Client | null = null;
  private connected = false;

  async connect(workspaceRoot: string): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    const serverPath = path.join(
      workspaceRoot,
      "packages",
      "mcp-server",
      "dist",
      "cli.js",
    );

    this.client = new Client(
      {
        name: "hexagen-tui",
        version: "0.1.0",
      },
      {
        capabilities: {},
      },
    );

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverPath, "--workspace-root", workspaceRoot],
      cwd: workspaceRoot,
    });

    await this.client.connect(transport);
    this.connected = true;
  }

  async listResources(): Promise<unknown> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }
    return this.client.listResources();
  }

  async readResource(uri: string): Promise<unknown> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }
    return this.client.readResource({ uri });
  }

  async listTools(): Promise<unknown> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }
    return this.client.listTools();
  }

  async callTool(input: MCPToolCallInput): Promise<unknown> {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }
    return this.client.callTool({
      name: input.name,
      arguments: input.arguments,
    });
  }
}
