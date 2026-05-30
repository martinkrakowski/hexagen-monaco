import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { NextjsAdapter } from "@bull-board/nextjs";
import { isFallbackActive } from "../../../../src/infrastructure/queue/connection";
import { QUEUE_NAMES, getQueue } from "../../../../src/infrastructure/queue/queues";

// Bull Board dashboard mounted at BULL_BOARD_BASE_PATH (default /admin/queues).
// In production we require HTTP Basic Auth (BULL_BOARD_USERNAME +
// BULL_BOARD_PASSWORD); in development the route is open to keep iteration
// friction down. When the queue layer is in fallback mode there are no real
// Bull queues to inspect — we return 503 with a hint rather than a confusing
// empty board.

const BASE_PATH = process.env.BULL_BOARD_BASE_PATH ?? "/admin/queues";
const ENABLED = (process.env.BULL_BOARD_ENABLED ?? "true").toLowerCase() !== "false";
const USERNAME = process.env.BULL_BOARD_USERNAME ?? "";
const PASSWORD = process.env.BULL_BOARD_PASSWORD ?? "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const serverAdapter = new NextjsAdapter();
serverAdapter.setBasePath(BASE_PATH);

let initialized = false;

function init(): void {
  if (initialized) return;
  if (isFallbackActive()) return;
  createBullBoard({
    queues: QUEUE_NAMES.map((n) => new BullMQAdapter(getQueue(n))),
    serverAdapter,
  });
  initialized = true;
}

function unauthorized(): NextResponse {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="bull-board"' },
  });
}

// Constant-time string comparison. timingSafeEqual requires equal-length
// buffers; pad / mismatch handling keeps the runtime constant regardless of
// the inputs so an attacker can't learn the expected username or password
// length from the response time.
function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Still do a constant-time op on a same-length buffer so the length-
    // mismatch path takes a comparable wall-clock time.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function checkAuth(request: NextRequest): NextResponse | null {
  if (!IS_PRODUCTION) return null;
  if (!USERNAME || !PASSWORD) {
    return new NextResponse(
      "Bull Board is disabled: BULL_BOARD_USERNAME and BULL_BOARD_PASSWORD must be set in production.",
      { status: 503 },
    );
  }
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return unauthorized();
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return unauthorized();
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  // Evaluate BOTH sides so a wrong username doesn't short-circuit the
  // password comparison — that asymmetry would leak whether the username
  // was correct via the response time.
  const userOk = safeCompare(user, USERNAME);
  const passOk = safeCompare(pass, PASSWORD);
  if (!userOk || !passOk) return unauthorized();
  return null;
}

async function handle(request: NextRequest): Promise<Response> {
  if (!ENABLED) return new NextResponse("Bull Board is disabled.", { status: 404 });
  const authErr = checkAuth(request);
  if (authErr) return authErr;
  if (isFallbackActive()) {
    return new NextResponse(
      "Bull Board: queue layer is running in fallback mode (no Redis). No real queues to display.",
      { status: 503 },
    );
  }
  init();
  return serverAdapter.handleRequest(request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
