// @hexagen-server-only — network-exposed transport; holds no logic and gates
// every request through auth before the MCP layer sees it (ADR-0037).
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { TransportFactory } from "../server.js";
import { assertSafeTransport } from "../guard.js";
import { authenticate } from "../auth/{auth}.js";

/**
 * Streamable-HTTP transport factory. Unlike stdio (a one-shot subprocess pipe),
 * the HTTP transport is request-driven: it needs a Node http server to feed it
 * requests via `transport.handleRequest(req, res)`. This factory builds the
 * transport in stateless mode, stands up that listener on MCP_HTTP_PORT
 * (authenticating every request first), and returns the transport so the
 * composition root can `server.connect()` it. The SDK is dynamically imported
 * (ADR-0010).
 *
 * The listener's port opens asynchronously, after this factory returns, so the
 * composition root's `await server.connect(transport)` (run immediately after)
 * wires the protocol before the first request can arrive — no connect/listen
 * race. For stateful multi-client deployments pass a `sessionIdGenerator`
 * instead of `undefined` (see the SDK docs).
 */
export const createHttpTransport: TransportFactory = async () => {
  // Defense-in-depth: refuse to expose the server over the network without auth,
  // even if MCP_AUTH_MODE was cleared in a hand-edited .env.
  assertSafeTransport(process.env);

  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: one transport, no session tracking
  });

  const port = Number(process.env.MCP_HTTP_PORT) || 3333;
  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!(await authenticate(req))) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        await transport.handleRequest(req, res);
      } catch (error: unknown) {
        console.error("[mcp-http] request failed:", error);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal_error" }));
        }
      }
    },
  );

  httpServer.listen(port, () => {
    console.error(`[mcp-http] listening on :${port}`);
  });

  return transport;
};
