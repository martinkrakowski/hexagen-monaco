import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { runLaneWatch } from "../../src/lane-watch/cli.js";

/**
 * A local fake of the one opencode HTTP surface lane-watch reads. Nothing here
 * can reach a real server: it listens on 127.0.0.1 port 0 and every test closes
 * it, destroying whatever sockets a deliberately-hung response left open.
 */
export interface Fake {
  readonly origin: string;
  readonly requests: string[];
  readonly closed: Promise<void>[];
  close(): Promise<void>;
}

export type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  fake: Fake,
) => void;

export async function startFake(handler: Handler): Promise<Fake> {
  const sockets = new Set<Socket>();
  const requests: string[] = [];
  const closed: Promise<void>[] = [];
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? "");
    closed.push(new Promise<void>((done) => res.on("close", () => done())));
    handler(req, res, fake);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("addr");
  const fake: Fake = {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    closed,
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
  return fake;
}

export const SESSION = "ses_abc123";

/** One `/global/event` data frame, in the server's `{directory, payload}` shape. */
export function frame(type: string, properties: unknown): string {
  return `data: ${JSON.stringify({ directory: "/x", payload: { type, properties } })}\n\n`;
}

export const heartbeat = (): string => frame("server.heartbeat", {});
export const idle = (sessionID = SESSION): string =>
  frame("session.idle", { sessionID });

export function sseHead(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  res.flushHeaders();
}

export interface Ran {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly fetchCalls: { url: string; init: RequestInit }[];
}

/** Run the CLI against real `fetch`, recording every call it makes. */
export async function run(
  argv: string[],
  extra: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const base = extra.fetch ?? fetch;
  const code = await runLaneWatch({
    argv,
    log: (text) => out.push(text),
    logError: (text) => err.push(text),
    fetch: (url, init) => {
      fetchCalls.push({ url, init });
      return base(url, init);
    },
    ...(extra.signal !== undefined ? { signal: extra.signal } : {}),
  });
  return { code, out, err, fetchCalls };
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));
