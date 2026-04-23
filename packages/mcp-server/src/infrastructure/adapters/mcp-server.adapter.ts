import type { MCPServerPort } from "../../application/ports/in/mcp-server.port.js";
import type { AddDependencyToolUseCase } from "../../application/use-cases/add-dependency-tool.use-case.js";
import type { AuditBoundariesToolUseCase } from "../../application/use-cases/audit-boundaries-tool.use-case.js";
import type { CreateAdapterToolUseCase } from "../../application/use-cases/create-adapter-tool.use-case.js";
import type { CreateContextToolUseCase } from "../../application/use-cases/create-context-tool.use-case.js";
import type { DiffManifestToolUseCase } from "../../application/use-cases/diff-manifest-tool.use-case.js";
import type { CreatePortToolUseCase } from "../../application/use-cases/create-port-tool.use-case.js";
import type { GetGraphResourceUseCase } from "../../application/use-cases/get-graph-resource.use-case.js";
import type { GetDecisionsResourceUseCase } from "../../application/use-cases/get-decisions-resource.use-case.js";
import type { GetInvariantsResourceUseCase } from "../../application/use-cases/get-invariants-resource.use-case.js";
import type { GetLinterConfigResourceUseCase } from "../../application/use-cases/get-linter-config-resource.use-case.js";
import type { GetLinterReportResourceUseCase } from "../../application/use-cases/get-linter-report-resource.use-case.js";
import type { GetManifestResourceUseCase } from "../../application/use-cases/get-manifest-resource.use-case.js";
import type { GetWorkspaceContextResourceUseCase } from "../../application/use-cases/get-workspace-context-resource.use-case.js";
import type { RemoveContextToolUseCase } from "../../application/use-cases/remove-context-tool.use-case.js";
import type { RemovePortToolUseCase } from "../../application/use-cases/remove-port-tool.use-case.js";
import type { ScaffoldModuleToolUseCase } from "../../application/use-cases/scaffold-module-tool.use-case.js";

interface MCPServerAdapterDependencies {
  getManifestResourceUseCase: GetManifestResourceUseCase;
  getGraphResourceUseCase: GetGraphResourceUseCase;
  getLinterReportResourceUseCase: GetLinterReportResourceUseCase;
  getDecisionsResourceUseCase: GetDecisionsResourceUseCase;
  getInvariantsResourceUseCase: GetInvariantsResourceUseCase;
  getLinterConfigResourceUseCase: GetLinterConfigResourceUseCase;
  getWorkspaceContextResourceUseCase: GetWorkspaceContextResourceUseCase;
  auditBoundariesToolUseCase: AuditBoundariesToolUseCase;
  scaffoldModuleToolUseCase: ScaffoldModuleToolUseCase;
  addDependencyToolUseCase: AddDependencyToolUseCase;
  createPortToolUseCase: CreatePortToolUseCase;
  createAdapterToolUseCase: CreateAdapterToolUseCase;
  removePortToolUseCase: RemovePortToolUseCase;
  removeContextToolUseCase: RemoveContextToolUseCase;
  createContextToolUseCase: CreateContextToolUseCase;
  diffManifestToolUseCase: DiffManifestToolUseCase;
}

interface MCPServerRuntime {
  connect(transport: unknown): Promise<void>;
  setRequestHandler(
    schema: unknown,
    handler: (request: unknown) => Promise<unknown>,
  ): void;
  close?: () => Promise<void> | void;
}

interface MCPSchemas {
  CallToolRequestSchema: unknown;
  ListToolsRequestSchema: unknown;
  ListResourcesRequestSchema: unknown;
  ReadResourceRequestSchema: unknown;
}

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
        resources: [
          {
            uri: "architecture://manifest",
            name: "Architecture Manifest",
            description: "HexaGen architecture manifest",
            mimeType: "application/json",
          },
          {
            uri: "architecture://graph",
            name: "Architecture Graph",
            description: "Bounded context dependency graph",
            mimeType: "application/json",
          },
        {
          uri: "architecture://linter-report",
          name: "Architecture Linter Report",
          description: "Latest architecture lint report",
          mimeType: "application/json",
        },
        {
          uri: "architecture://decisions",
          name: "Architecture Decisions",
          description: "ADR documents from .architecture/decisions/",
          mimeType: "application/json",
        },
        {
          uri: "architecture://invariants",
          name: "Architecture Invariants",
          description: "Layer rules and cross-package boundaries",
          mimeType: "application/json",
        },
        {
          uri: "architecture://linter-config",
          name: "Linter Configuration",
          description: "Package-level linter rules",
          mimeType: "application/json",
        },
        {
          uri: "architecture://workspace-context",
          name: "Workspace Context",
          description: "High-level workspace metadata",
          mimeType: "application/json",
        },
        ],
      };
    });

    server.setRequestHandler(
      schemas.ReadResourceRequestSchema,
      async (request: unknown) => {
        const req = request as { params: { uri: string } };
        const uri = req.params.uri;

        if (uri === "architecture://manifest") {
          const result =
            await this.dependencies.getManifestResourceUseCase.execute();
          if (!result.success) throw result.error;
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result.value, null, 2),
              },
            ],
          };
        }

        if (uri === "architecture://graph") {
          const result =
            await this.dependencies.getGraphResourceUseCase.execute();
          if (!result.success) throw result.error;
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result.value, null, 2),
              },
            ],
          };
        }

      if (uri === "architecture://linter-report") {
        const result =
          await this.dependencies.getLinterReportResourceUseCase.execute();
        if (!result.success) throw result.error;
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result.value, null, 2),
            },
          ],
        };
      }

      if (uri === "architecture://decisions") {
        const result =
          await this.dependencies.getDecisionsResourceUseCase.execute();
        if (!result.success) throw result.error;
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result.value, null, 2),
            },
          ],
        };
      }

      if (uri === "architecture://invariants") {
        const result =
          await this.dependencies.getInvariantsResourceUseCase.execute();
        if (!result.success) throw result.error;
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result.value, null, 2),
            },
          ],
        };
      }

      if (uri === "architecture://linter-config") {
        const result =
          await this.dependencies.getLinterConfigResourceUseCase.execute();
        if (!result.success) throw result.error;
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result.value, null, 2),
            },
          ],
        };
      }

      if (uri === "architecture://workspace-context") {
        const result =
          await this.dependencies.getWorkspaceContextResourceUseCase.execute();
        if (!result.success) throw result.error;
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result.value, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
      },
    );
  }

  private registerToolHandlers(
    server: MCPServerRuntime,
    schemas: MCPSchemas,
  ): void {
    server.setRequestHandler(schemas.ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "hexagen_audit_boundaries",
            description:
              "Runs architecture linter and returns structured report",
            inputSchema: {
              type: "object",
              properties: {
                dry_run: { type: "boolean" },
              },
            },
          },
          {
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
          },
          {
            name: "hexagen_add_dependency",
            description: "Safely add dependency relation in manifest",
            inputSchema: {
              type: "object",
              properties: {
                source_module: { type: "string" },
                target_module: { type: "string" },
                dry_run: { type: "boolean" },
              },
              required: ["source_module", "target_module"],
            },
          },
          {
            name: "hexagen_create_port",
            description: "Create a new port contract",
            inputSchema: {
              type: "object",
              properties: {
                domain_name: { type: "string" },
                port_name: { type: "string" },
                type: { type: "string", enum: ["inbound", "outbound"] },
                dry_run: { type: "boolean" },
              },
              required: ["domain_name", "port_name", "type"],
            },
          },
          {
            name: "hexagen_create_adapter",
            description: "Create a new infrastructure adapter",
            inputSchema: {
              type: "object",
              properties: {
                port_name: { type: "string" },
                infrastructure_name: { type: "string" },
                dry_run: { type: "boolean" },
              },
              required: ["port_name", "infrastructure_name"],
            },
          },
          {
            name: "hexagen_remove_port",
            description: "Remove a port from a bounded context",
            inputSchema: {
              type: "object",
              properties: {
                context_name: { type: "string" },
                port_name: { type: "string" },
                direction: { type: "string", enum: ["inbound", "outbound"] },
                dry_run: { type: "boolean" },
              },
              required: ["context_name", "port_name", "direction"],
            },
          },
          {
            name: "hexagen_remove_context",
            description: "Remove a bounded context from the manifest",
            inputSchema: {
              type: "object",
              properties: {
                context_name: { type: "string" },
                dry_run: { type: "boolean" },
              },
              required: ["context_name"],
            },
          },
          {
            name: "hexagen_create_context",
            description: "Create a new bounded context in the manifest",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: {
                  type: "string",
                  enum: ["core", "supporting", "driver", "shared-kernel"],
                },
                description: { type: "string" },
                dry_run: { type: "boolean" },
              },
              required: ["name", "type"],
            },
          },
          {
            name: "hexagen_diff_manifest",
            description:
              "Compare current manifest against git HEAD or a file and return structural diff",
            inputSchema: {
              type: "object",
              properties: {
                compare_source: {
                  type: "string",
                  enum: ["git_head", "file"],
                  description:
                    "Source to compare against (default: git_head)",
                },
                file_path: {
                  type: "string",
                  description:
                    "Path to manifest file for comparison (required when compare_source is 'file')",
                },
              },
            },
          },
        ],
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

          if (name === "hexagen_audit_boundaries") {
            const result =
              await this.dependencies.auditBoundariesToolUseCase.execute({
                dry_run: (args.dry_run as boolean | undefined) ?? true,
              });
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
            };
          }

          if (name === "hexagen_scaffold_module") {
            const result =
              await this.dependencies.scaffoldModuleToolUseCase.execute({
                name: String(args.name ?? ""),
                layer: String(args.layer ?? "domain") as
                  | "domain"
                  | "application"
                  | "infrastructure",
                context_type: args.context_type as
                  | "core"
                  | "supporting"
                  | "driver"
                  | "shared-kernel"
                  | undefined,
                dry_run: (args.dry_run as boolean | undefined) ?? false,
              });
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
            };
          }

          if (name === "hexagen_add_dependency") {
            const result =
              await this.dependencies.addDependencyToolUseCase.execute({
                sourceModule: String(args.source_module ?? ""),
                targetModule: String(args.target_module ?? ""),
                dry_run: (args.dry_run as boolean | undefined) ?? false,
              });
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
            };
          }

          if (name === "hexagen_create_port") {
            const result =
              await this.dependencies.createPortToolUseCase.execute({
                domain_name: String(args.domain_name ?? ""),
                port_name: String(args.port_name ?? ""),
                type: String(args.type ?? "inbound") as "inbound" | "outbound",
                dry_run: (args.dry_run as boolean | undefined) ?? false,
              });
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
            };
          }

          if (name === "hexagen_create_adapter") {
            const result =
              await this.dependencies.createAdapterToolUseCase.execute({
                port_name: String(args.port_name ?? ""),
                infrastructure_name: String(args.infrastructure_name ?? ""),
                dry_run: (args.dry_run as boolean | undefined) ?? false,
              });
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
            };
          }

          if (name === "hexagen_remove_port") {
            const result =
              await this.dependencies.removePortToolUseCase.execute({
                context_name: String(args.context_name ?? ""),
                port_name: String(args.port_name ?? ""),
                direction: String(args.direction ?? "inbound") as
                  | "inbound"
                  | "outbound",
                dry_run: (args.dry_run as boolean | undefined) ?? false,
              });
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
            };
          }

          if (name === "hexagen_remove_context") {
            const result =
              await this.dependencies.removeContextToolUseCase.execute({
                context_name: String(args.context_name ?? ""),
                dry_run: (args.dry_run as boolean | undefined) ?? false,
              });
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
            };
          }

        if (name === "hexagen_create_context") {
          const result =
            await this.dependencies.createContextToolUseCase.execute({
              name: String(args.name ?? ""),
              type: String(args.type ?? "core") as
                | "core"
                | "supporting"
                | "driver"
                | "shared-kernel",
              description: args.description as string | undefined,
              dry_run: (args.dry_run as boolean | undefined) ?? false,
            });
          return {
            content: [
              { type: "text", text: JSON.stringify(result, null, 2) },
            ],
          };
        }

        if (name === "hexagen_diff_manifest") {
          const result =
            await this.dependencies.diffManifestToolUseCase.execute({
              compare_source: args.compare_source as
                | "git_head"
                | "file"
                | undefined,
              file_path: args.file_path as string | undefined,
            });
          if (result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result.value, null, 2),
                },
              ],
            };
          }
          return {
            isError: true,
            content: [
              {
                type: "text",
                  text:
                    result.error instanceof Error
                      ? result.error.message
                      : String(result.error),
              },
            ],
          };
        }

          throw new Error(`Unknown tool: ${name}`);
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
