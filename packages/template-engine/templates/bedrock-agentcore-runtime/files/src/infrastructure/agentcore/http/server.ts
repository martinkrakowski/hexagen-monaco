import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createInvocationHandler } from "./invocations.handler";
import { handlePing } from "./ping.handler";
import type { AgentRuntimePort } from "../runtime/payload";

/**
 * AgentCore Runtime container entrypoint.
 *
 * AgentCore requires the container to listen on port 8080 and serve the HTTP
 * contract: `GET /ping` (health) and `POST /invocations` (the agent). This is a
 * dependency-free `node:http` server — no web framework — that adapts Node's
 * request/response to the Web-standard `Request`/`Response` handlers so the
 * handlers stay framework-agnostic and unit-testable.
 *
 * Wire your agent (any {@link AgentRuntimePort} implementation) into
 * `createAgentCoreServer(agent)`; the inbound adapter never depends on a
 * concrete agent.
 */
export const RUNTIME_PORT = Number(process.env.AGENTCORE_RUNTIME_PORT ?? 8080);

export function createAgentCoreServer(agent: AgentRuntimePort) {
  const handleInvocation = createInvocationHandler(agent);

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void route(req, handleInvocation)
      .then((response) => sendWebResponse(res, response))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[agentcore] unhandled server error", err);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      });
  });
}

async function route(
  req: IncomingMessage,
  handleInvocation: (request: Request) => Promise<Response>,
): Promise<Response> {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  if (method === "GET" && url === "/ping") {
    return handlePing();
  }
  if (method === "POST" && url === "/invocations") {
    return handleInvocation(await toWebRequest(req));
  }
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  // Buffer the whole body — AgentCore invocation envelopes are small JSON
  // (prompt + metadata), so this is fine. If you ever accept large or binary
  // uploads, stream `req` straight into the Request body instead of concatenating.
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value != null) headers.set(key, value);
  }
  return new Request(`http://localhost${req.url ?? "/"}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body) {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
  } else {
    const text = await response.text();
    if (text) res.write(text);
  }
  res.end();
}

/** Start the runtime. Returns once the socket is listening. */
export function startAgentCoreServer(agent: AgentRuntimePort): Promise<void> {
  const server = createAgentCoreServer(agent);
  return new Promise((resolve) => {
    server.listen(RUNTIME_PORT, "0.0.0.0", () => {
      const addr = server.address() as AddressInfo | null;
      // eslint-disable-next-line no-console
      console.log(`[agentcore] runtime listening on :${addr?.port ?? RUNTIME_PORT}`);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Container bootstrap. The Dockerfile's CMD runs this file directly.
//
// TODO(you): replace `placeholderAgent` with your real agent — e.g. construct
// your LangGraph graph / tool-calling loop and adapt it to AgentRuntimePort.
// If observability is installed, also wire the correlation seam here (see
// session.ts module docs).
// ---------------------------------------------------------------------------
const placeholderAgent: AgentRuntimePort = {
  async run({ prompt }) {
    throw new Error(
      `AgentCore runtime is not wired yet. Implement AgentRuntimePort and pass it to ` +
        `startAgentCoreServer() in src/infrastructure/agentcore/http/server.ts ` +
        `(received prompt: ${JSON.stringify(prompt.slice(0, 40))}).`,
    );
  },
};

// Run only when executed as the entrypoint, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void startAgentCoreServer(placeholderAgent);
}
