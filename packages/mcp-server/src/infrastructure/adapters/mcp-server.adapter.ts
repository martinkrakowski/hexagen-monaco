import type { MCPServerPort } from "../../application/ports/in/mcp-server.port.js";
import type {
  MCPServerAdapterDependencies,
  MCPServerRuntime,
  MCPSchemas,
} from "./mcp-server.types.js";
import { toolRegistry, allTools } from "./tools/registry.js";
import { resourceRegistry, resources } from "./resources/index.js";

export type {
  MCPServerAdapterDependencies,
  MCPServerRuntime,
  MCPSchemas,
} from "./mcp-server.types.js";

export class MCPServerAdapter implements MCPServerPort {
  private server: MCPServerRuntime | null = null;

  constructor(private readonly dependencies: MCPServerAdapterDependencies) {}

  async start(): Promise<void> {
    const sdkServerModulePath = "@modelcontextprotocol/sdk/server/index.js";
    const sdkStdioModulePath = "@modelcontextprotocol/sdk/server/stdio.js";
    const sdkTypesModulePath = "@modelcontextprotocol/sdk/types.js";

    const sdkServerModule = (await import(sdkServerModulePath)) as {
      Server: new (
        info: { name: string; version: string },
        options: {
          capabilities: {
            tools: Record<string, never>;
            resources: Record<string, never>;
          };
        },
      ) => MCPServerRuntime;
    };

    const sdkStdioModule = (await import(sdkStdioModulePath)) as {
      StdioServerTransport: new () => unknown;
    };

    const sdkTypesModule = (await import(sdkTypesModulePath)) as MCPSchemas;

    this.server = new sdkServerModule.Server(
      {
        name: "hexagen-mcp-engine",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    );

    this.registerResourceHandlers(this.server, sdkTypesModule);
    this.registerToolHandlers(this.server, sdkTypesModule);

    const transport = new sdkStdioModule.StdioServerTransport();
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    if (this.server?.close) {
      await this.server.close();
    }
  }

  private registerResourceHandlers(
    server: MCPServerRuntime,
    schemas: MCPSchemas,
  ): void {
    server.setRequestHandler(schemas.ListResourcesRequestSchema, async () => {
      return {
        resources: resources.map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        })),
      };
    });

    server.setRequestHandler(
      schemas.ReadResourceRequestSchema,
      async (request: unknown) => {
        const req = request as { params: { uri: string } };
        const uri = req.params.uri;
        const resource = resourceRegistry.get(uri);
        if (!resource) {
          throw new Error(`Unknown resource: ${uri}`);
        }
        return resource.read(this.dependencies);
      },
    );
  }

  private registerToolHandlers(
    server: MCPServerRuntime,
    schemas: MCPSchemas,
  ): void {
    server.setRequestHandler(schemas.ListToolsRequestSchema, async () => {
      return {
        tools: allTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    server.setRequestHandler(
      schemas.CallToolRequestSchema,
      async (request: unknown) => {
        try {
          const req = request as {
            params: {
              name: string;
              arguments?: Record<string, unknown>;
            };
          };
          const name = req.params.name;
          const args = req.params.arguments ?? {};
          const tool = toolRegistry.get(name);
          if (!tool) {
            throw new Error(`Unknown tool: ${name}`);
          }
          return await tool.handler(args, this.dependencies);
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      },
    );
  }
}
