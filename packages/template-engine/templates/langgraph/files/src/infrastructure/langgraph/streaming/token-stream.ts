import type { GraphEvent } from "../../../domain/ports/out/agent-graph.port";

/**
 * Server-Sent Events encoder for a graph's `AsyncIterable<GraphEvent>`.
 * Each event is serialised as a single SSE `data:` frame with a heartbeat
 * comment line every ~15s so intermediate proxies don't drop an idle
 * stream (Cloudflare, Vercel edges, etc.).
 *
 * Usage from a Next.js route:
 *
 *   const stream = streamGraphAsSse(adapter.stream(input));
 *   return new Response(stream, {
 *     headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
 *   });
 */
const HEARTBEAT_INTERVAL_MS = 15_000;
const encoder = new TextEncoder();

export function streamGraphAsSse(
  events: AsyncIterable<GraphEvent>,
): ReadableStream<Uint8Array> {
  // Hold the live iterator + heartbeat on the closure so cancel() can
  // tear them down promptly when the client disconnects. Without this,
  // the underlying for-await loop keeps draining graph events (and
  // burning LLM tokens) until the upstream generator naturally ends.
  let iterator: AsyncIterator<GraphEvent> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      iterator = events[Symbol.asyncIterator]();
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Controller closed (client disconnected); the for-await loop
          // below will throw next iteration and we'll clean up there.
        }
      }, HEARTBEAT_INTERVAL_MS);
      try {
        while (true) {
          const { done, value } = await iterator.next();
          if (done) break;
          if (cancelled) break;
          const frame = `event: ${value.type}\ndata: ${JSON.stringify(value.data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        }
        if (!cancelled) {
          controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        const frame = `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Best-effort error frame; if the controller is gone, drop it.
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        try {
          controller.close();
        } catch {
          // Already closed via cancel() — fine.
        }
      }
    },
    async cancel() {
      // The client disconnected (closed tab, Abort signal, edge timeout
      // …). Stop the heartbeat AND tell the upstream generator to wind
      // down, otherwise it would keep advancing through LangGraph nodes
      // for a connection that nobody is listening to.
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      if (iterator?.return) {
        await iterator.return(undefined).catch(() => undefined);
      }
    },
  });
}
