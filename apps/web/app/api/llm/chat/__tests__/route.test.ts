import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Mock the route's boundaries: an anonymous session, server-key resolution +
// provider wiring, the BYOK use case (whose module transitively imports SQLite),
// and the server-chat use case (its stream is irrelevant to the rate-limit path
// under test). The shared fixed-window limiter and the in-memory free-tier
// quota store run for real.
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock("@/lib/auth.js", () => ({ authOptions: {} }));
vi.mock("@/lib/wire.shared", () => ({
  createLLMProvider: vi.fn(() => ({})),
  resolveWebLlmApiKey: vi.fn(() => "server-key"),
}));
vi.mock("@/lib/byok-wire.js", () => ({ getProxyRequestUseCase: vi.fn() }));
vi.mock("@hexagen/agentic-interaction", () => ({
  HandleServerChatUseCase: class {
    async handleRequest() {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    }
  },
}));

import { POST } from "../route";

// An anonymous chat POST with NO forwarding headers (no X-Forwarded-For /
// X-Real-IP) and only a distinguishing User-Agent — the header-less case where
// the route must NOT collapse callers into one shared rate-limit bucket.
function headerlessPost(userAgent: string): NextRequest {
  return new NextRequest("http://localhost/api/llm/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("POST /api/llm/chat — anonymous rate-limit keying", () => {
  it("keys header-less anonymous callers per-caller, not into one shared 'anon' bucket", async () => {
    // No X-Forwarded-For / X-Real-IP: the route must hand the shared limiter the
    // authenticated principal (undefined here) — NOT a route-local "anon"
    // sentinel — so the limiter derives its own per-caller key (a User-Agent /
    // Accept-Language fingerprint when no IP is present). Passing "anon" would
    // collapse every header-less anonymous caller into ONE bucket, letting a
    // single caller exhaust the window for all of them.

    // Caller A fills its OWN window: 10 allowed, the 11th confirms it is full.
    let aRes: Response | null = null;
    for (let i = 0; i < 11; i++) aRes = await POST(headerlessPost("agent-A"));
    assert.strictEqual(aRes!.status, 429);

    // A distinct header-less caller must be unaffected. A shared "anon" bucket
    // would already be exhausted by A, throttling B on its first request.
    const bRes = await POST(headerlessPost("agent-B"));
    assert.strictEqual(bRes.status, 200);
  });
});
