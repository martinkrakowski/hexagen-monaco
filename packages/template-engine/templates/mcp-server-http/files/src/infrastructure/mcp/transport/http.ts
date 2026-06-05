// @hexagen-server-only — network-exposed transport; holds no logic and gates
// every request through auth before the MCP layer sees it (ADR-0037).
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { TransportFactory } from "../server.js";
import { assertSafeTransport } from "../guard.js";
import { authenticate, assertConfigured } from "../auth/{auth}.js";

/**
 * Streamable-HTTP transport factory. Unlike stdio (a one-shot subprocess pipe),
 * the HTTP transport is request-driven: it needs a Node http server to feed it
 * requests via `transport.handleRequest(req, res)`. This factory builds a
 * stateless transport plus a Node http listener (authenticating every request
 * first), then ties the listener into the transport's own lifecycle:
 *
 *  - The port opens in `transport.start()`, which `server.connect()` invokes
 *    only AFTER it has wired `onmessage`/`onclose`/`onerror` — so no request can
 *    reach `handleRequest` before the transport is connected to the McpServer.
 *  - `transport.close()` shuts the listener down, so stopping the MCP server
 *    frees the port and lets the process exit (no dangling listener, no
 *    EADDRINUSE on restart).
 *  - A bind failure (e.g. EADDRINUSE) rejects `start()` with a clear error
 *    rather than crashing the process with an unhandled `'error'` event.
 *
 * The SDK is dynamically imported (ADR-0010). For stateful multi-client
 * deployments, pass a `sessionIdGenerator` instead of `undefined` (see SDK docs).
 */
export const createHttpTransport: TransportFactory = async () => {
  // Defense-in-depth: refuse to expose the server over the network without auth
  // (even if MCP_AUTH_MODE was cleared in a hand-edited .env), and fail fast when
  // the chosen auth's secret is unset — otherwise the server would start and
  // silently deny every request.
  assertSafeTransport(process.env);
  assertConfigured();

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

  // Open the port in start() (run by server.connect() after the message handlers
  // are wired) and surface a bind error there instead of as an unhandled event.
  const baseStart = transport.start.bind(transport);
  transport.start = async () => {
    await baseStart();
    await new Promise<void>((resolve, reject) => {
      const onBindError = (err: Error) => reject(err);
      httpServer.once("error", onBindError);
      httpServer.listen(port, () => {
        httpServer.removeListener("error", onBindError);
        httpServer.on("error", (err) =>
          console.error("[mcp-http] server error:", err),
        );
        console.error(`[mcp-http] listening on :${port}`);
        resolve();
      });
    });
  };

  // Free the listener when the MCP server shuts down, so the port is released
  // and the event loop can exit.
  const baseClose = transport.close.bind(transport);
  transport.close = async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await baseClose();
  };

  return transport;
};
