// @hexagen-server-only — composition root; holds privileged use-cases (ADR-0037).
import { loadSdk } from "./sdk.js";
import { applyTools } from "./registry/tool-registry.js";

/**
 * Builds a transport instance on demand. A **factory**, not an instance, so an
 * addon (e.g. `mcp-server-http`) can register a fully-configured transport
 * without this composition root knowing its options — and without depending on
 * when it is constructed.
 */
export type TransportFactory = () => Promise<unknown>;

const transportFactories = new Map<string, TransportFactory>();

/**
 * Register a transport under an `MCP_TRANSPORT` value. The base registers
 * `stdio`; the `mcp-server-http` addon registers `streamable-http` — each from
 * its own file via `transport/register-transports.ts`, so neither edits this file.
 */
export function registerTransport(
  name: string,
  factory: TransportFactory,
): void {
  transportFactories.set(name, factory);
}

/**
 * Compose and start the MCP server: load the SDK (dynamic import, ADR-0010),
 * build the server, wire the registered tools, then connect the transport
 * selected by `MCP_TRANSPORT` (default `stdio`). `register-all.ts` and
 * `register-transports.ts` must be imported first (see `bin/cli.ts`) so the
 * registries are populated.
 */
export async function startServer(): Promise<void> {
  const { McpServer } = await loadSdk();
  const server = new McpServer({
    name: process.env.MCP_SERVER_NAME || "{server_name}",
    version: "0.1.0",
  });

  applyTools(server);

  const transportName = process.env.MCP_TRANSPORT || "stdio";
  const factory = transportFactories.get(transportName);
  if (!factory) {
    const known = [...transportFactories.keys()].join(", ") || "(none)";
    throw new Error(
      `No MCP transport registered for MCP_TRANSPORT="${transportName}". Registered: ${known}.`,
    );
  }
  await server.connect(await factory());
}
