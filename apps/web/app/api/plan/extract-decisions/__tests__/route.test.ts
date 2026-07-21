import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ok, err } from "@hexagen/shared";
import type { LLMProviderPort } from "@hexagen/agentic-interaction";

// Mock the route's LLM boundary (provider wiring + server-key resolution) and
// the session boundary; the rate limiter and the free-tier quota store run for
// real (the quota store is in-memory under test).
vi.mock("@/lib/wire.shared", () => ({
  createLLMProvider: vi.fn(),
  resolveWebLlmApiKey: vi.fn(),
}));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => null),
}));
// authOptions pulls in the GitHub provider + env; the route only forwards it
// to getServerSession (mocked above), so an empty object is sufficient.
vi.mock("@/lib/auth.js", () => ({ authOptions: {} }));

import { POST } from "../route";
import { createLLMProvider, resolveWebLlmApiKey } from "@/lib/wire.shared";

function completion(content: string) {
  return ok({
    id: "cmpl-1",
    model: "test-model",
    choices: [
      {
        message: { role: "assistant" as const, content },
        finishReason: "stop",
      },
    ],
  });
}

/** Build a provider whose non-streaming complete() is the given mock. */
function providerWith(complete: LLMProviderPort["complete"]): LLMProviderPort {
  return {
    complete,
    streamComplete: vi.fn(),
  } as unknown as LLMProviderPort;
}

// The in-module rate limiter keys anonymous callers by X-Forwarded-For, so
// every test uses its own IP to keep the sliding windows independent.
function post(body: unknown, ip: string): NextRequest {
  return new NextRequest("http://localhost/api/plan/extract-decisions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/plan/extract-decisions", () => {
  beforeEach(() => {
    vi.mocked(resolveWebLlmApiKey).mockReturnValue("server-key");
    vi.mocked(createLLMProvider).mockReturnValue(
      providerWith(vi.fn(async () => completion("## Decisions\n\n- ship it"))),
    );
  });
  afterEach(() => {
    vi.mocked(createLLMProvider).mockReset();
    vi.mocked(resolveWebLlmApiKey).mockReset();
    vi.unstubAllEnvs();
  });

  it("returns 400 for a body that is not valid JSON", async () => {
    const res = await POST(post("{not json", "10.0.0.1"));
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /Invalid JSON/);
  });

  it("returns 401 when unauthenticated and no server LLM key is configured", async () => {
    vi.mocked(resolveWebLlmApiKey).mockReturnValue(undefined);
    const res = await POST(post({ transcript: "## A\n\nhello" }, "10.0.0.2"));
    assert.strictEqual(res.status, 401);
  });

  it("returns 400 when the transcript is missing or empty", async () => {
    const missing = await POST(post({ title: "t" }, "10.0.0.3"));
    assert.strictEqual(missing.status, 400);
    assert.match((await missing.json()).error, /'transcript'/);

    const empty = await POST(post({ transcript: "   " }, "10.0.0.3"));
    assert.strictEqual(empty.status, 400);
  });

  it("returns 400 for an oversized transcript", async () => {
    const res = await POST(
      post({ transcript: "a".repeat(200_001) }, "10.0.0.4"),
    );
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /too large/i);
  });

  it("accepts a transcript of exactly the 200k cap (boundary)", async () => {
    const res = await POST(
      post({ transcript: "a".repeat(200_000) }, "10.0.0.14"),
    );
    assert.strictEqual(res.status, 200);
  });

  it("returns the extracted decisions markdown on success", async () => {
    const complete = vi.fn(async () =>
      completion("## Decisions\n\n- adopt hexagonal core"),
    );
    vi.mocked(createLLMProvider).mockReturnValue(providerWith(complete));

    const res = await POST(
      post(
        { transcript: "## Grok\n\nwe should split ports", title: "Vellum" },
        "10.0.0.5",
      ),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(
      body.decisions,
      "## Decisions\n\n- adopt hexagonal core",
    );

    // Anonymous free-tier call: the quota gate mints a session cookie.
    assert.match(res.headers.get("set-cookie") ?? "", /./);

    assert.strictEqual(complete.mock.calls.length, 1);
    const request = complete.mock.calls[0][0];
    assert.strictEqual(request.messages[0].role, "system");
    assert.match(request.messages[1].content, /Session title: Vellum/);
    assert.match(request.messages[1].content, /we should split ports/);
    assert.strictEqual(
      request.maxTokens,
      4096,
      "explicit summary-sized output budget (not the adapter's 2048 default)",
    );
  });

  it("consults LLM_MODEL for the model id (mirrors the chat route's config)", async () => {
    // stubEnv rather than recomputing the route's own `LLM_MODEL || fallback`
    // expression — an unset test env cannot distinguish a hardcoded model id.
    vi.stubEnv("LLM_MODEL", "env-model");
    const complete = vi.fn(async () => completion("## Decisions\n\n- ok"));
    vi.mocked(createLLMProvider).mockReturnValue(providerWith(complete));

    const res = await POST(post({ transcript: "## A\n\nhi" }, "10.0.0.15"));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(complete.mock.calls[0][0].model, "env-model");
  });

  it("maps a provider failure to 502", async () => {
    vi.mocked(createLLMProvider).mockReturnValue(
      providerWith(vi.fn(async () => err(new Error("upstream exploded")))),
    );
    const res = await POST(post({ transcript: "## A\n\nhi" }, "10.0.0.6"));
    assert.strictEqual(res.status, 502);
    assert.match((await res.json()).error, /upstream exploded/);
  });

  it("maps an empty model response to 502", async () => {
    vi.mocked(createLLMProvider).mockReturnValue(
      providerWith(vi.fn(async () => completion("   "))),
    );
    const res = await POST(post({ transcript: "## A\n\nhi" }, "10.0.0.7"));
    assert.strictEqual(res.status, 502);
    assert.match((await res.json()).error, /empty response/);
  });

  it("appends a truncation notice when the model stopped on the output limit", async () => {
    vi.mocked(createLLMProvider).mockReturnValue(
      providerWith(
        vi.fn(async () =>
          ok({
            id: "cmpl-1",
            model: "test-model",
            choices: [
              {
                message: {
                  role: "assistant" as const,
                  content: "## Decisions\n\n- partial",
                },
                finishReason: "length",
              },
            ],
          }),
        ),
      ),
    );
    const res = await POST(post({ transcript: "## A\n\nhi" }, "10.0.0.16"));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.match(body.decisions, /- partial/);
    assert.match(body.decisions, /truncated/i);
  });

  it("maps a throwing provider to 500 (catch arm)", async () => {
    vi.mocked(createLLMProvider).mockReturnValue(
      providerWith(
        vi.fn(async () => {
          throw new Error("wiring exploded");
        }),
      ),
    );
    const res = await POST(post({ transcript: "## A\n\nhi" }, "10.0.0.17"));
    assert.strictEqual(res.status, 500);
    assert.match((await res.json()).error, /wiring exploded/);
  });

  it("rate limits an anonymous caller after 10 requests in the window", async () => {
    let res: Response | null = null;
    for (let i = 0; i < 11; i++) {
      res = await POST(post({ transcript: "## A\n\nhi" }, "10.0.0.8"));
    }
    assert.ok(res);
    assert.strictEqual(res.status, 429);
    assert.match((await res.json()).error, /Too many requests/);
  });
});
