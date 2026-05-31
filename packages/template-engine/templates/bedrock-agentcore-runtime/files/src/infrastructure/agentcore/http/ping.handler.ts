/**
 * AgentCore health endpoint — `GET /ping`.
 *
 * AgentCore Runtime polls this to gate traffic; it must return 200 quickly and
 * cheaply (no model calls, no I/O). The `{"status":"Healthy"}` body matches the
 * shape AgentCore expects. Keep this synchronous and dependency-free.
 */
export function handlePing(): Response {
  return new Response(JSON.stringify({ status: "Healthy" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
