// @hexagen-server-only
import type { TransportFactory } from "../server.js";

/**
 * stdio transport factory — the secure local default: the server runs as a
 * subprocess of a trusted client (Claude Desktop/Code, an IDE), with no network
 * surface. The SDK transport is dynamically imported (ADR-0010).
 */
export const createStdioTransport: TransportFactory = async () => {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  return new StdioServerTransport();
};
