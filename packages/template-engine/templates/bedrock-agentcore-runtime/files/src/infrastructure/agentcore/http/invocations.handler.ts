import {
  invocationPayloadSchema,
  type AgentRuntimePort,
  type InvocationResponse,
} from "../runtime/payload";
import { readSessionId, withSession } from "../runtime/session";

/**
 * AgentCore primary endpoint — `POST /invocations`.
 *
 * Inbound adapter: validate the body, resolve the correlation/session id, run
 * the injected agent use-case (streamed or buffered), and map the result to the
 * AgentCore response contract. Depends only on {@link AgentRuntimePort} — never
 * on a concrete agent — so any agent implementation drops in unchanged.
 */
export function createInvocationHandler(
  agent: AgentRuntimePort,
): (request: Request) => Promise<Response> {
  return async function handleInvocation(request: Request): Promise<Response> {
    const auth = await authenticateInbound(request.headers);
    if (!auth.ok) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "Request body must be valid JSON" });
    }

    const parsed = invocationPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return json(400, { error: parsed.error.issues[0]?.message ?? "Invalid payload" });
    }

    const { prompt, sessionId: bodySessionId, stream, metadata } = parsed.data;
    const sessionId = readSessionId(request.headers, bodySessionId);

    // Seed the correlation context (a no-op unless observability is wired) so the
    // whole invocation — including the agent's downstream LLM calls — shares one id.
    return withSession(sessionId, async () => {
      try {
        if (stream && typeof agent.runStream === "function") {
          return streamResponse(agent, { prompt, sessionId, metadata });
        }
        const result = await agent.run({ prompt, sessionId, metadata });
        const payload: InvocationResponse = {
          output: result.output,
          sessionId,
          metadata: result.metadata,
        };
        return json(200, payload);
      } catch (err) {
        // The agent owns its own retry/Result handling; an escape here is an
        // unexpected fault. Don't leak internals to the caller.
        // eslint-disable-next-line no-console
        console.error(`[agentcore] invocation failed (session ${sessionId})`, err);
        return json(500, { error: "Agent invocation failed", sessionId });
      }
    });
  };
}

function streamResponse(
  agent: AgentRuntimePort,
  input: { prompt: string; sessionId: string; metadata?: Record<string, unknown> },
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of agent.runStream!(input)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "stream failed" })}\n\n`),
        );
        // eslint-disable-next-line no-console
        console.error(`[agentcore] stream failed (session ${input.sessionId})`, err);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

/**
 * Inbound auth gate. When `AGENTCORE_OAUTH_DISCOVERY_URL` is set (inbound_auth =
 * OAuth) a Bearer token is required on every call. Full JWT signature/audience
 * verification against the discovery document is environment-specific, so it is
 * supplied via {@link setTokenVerifier}. This is **fail-closed**: if OAuth mode
 * is enabled but no verifier has been registered, every call is rejected (rather
 * than silently accepting any token). With no discovery URL the runtime boundary
 * is IAM (SigV4), already enforced by AgentCore upstream, so this is a pass-through.
 */
async function authenticateInbound(
  headers: Headers,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const discoveryUrl = process.env.AGENTCORE_OAUTH_DISCOVERY_URL;
  if (!discoveryUrl) return { ok: true };

  const authorization = headers.get("authorization");
  const token = authorization?.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : undefined;
  if (!token) {
    return { ok: false, response: json(401, { error: "Missing bearer token" }) };
  }
  const verifier = verifyToken;
  if (!verifier) {
    // Fail closed: OAuth is on but no real verifier was wired. Accepting the
    // token here would be an auth bypass, so reject and tell the operator.
    // eslint-disable-next-line no-console
    console.error(
      "[agentcore] AGENTCORE_OAUTH_DISCOVERY_URL is set but no token verifier is " +
        "registered — call setTokenVerifier() at startup. Rejecting request.",
    );
    return { ok: false, response: json(500, { error: "Inbound auth is misconfigured" }) };
  }
  if (!(await verifier(token))) {
    return { ok: false, response: json(401, { error: "Invalid bearer token" }) };
  }
  return { ok: true };
}

type TokenVerifier = (token: string) => boolean | Promise<boolean>;

// No default verifier: OAuth mode is fail-closed until one is registered. Wire
// real JWKS / audience verification (audience = AGENTCORE_OAUTH_ALLOWED_AUDIENCE)
// against AGENTCORE_OAUTH_DISCOVERY_URL via setTokenVerifier() at startup.
let verifyToken: TokenVerifier | null = null;

/** Register real inbound-token verification (audience = AGENTCORE_OAUTH_ALLOWED_AUDIENCE). */
export function setTokenVerifier(verifier: TokenVerifier): void {
  verifyToken = verifier;
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
