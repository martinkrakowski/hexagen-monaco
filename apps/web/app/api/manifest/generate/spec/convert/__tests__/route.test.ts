import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route.ts";
import { NextRequest } from "next/server";
import { ExecuteLooseSpecConversionUseCase } from "@hexagen/agentic-interaction";
import { ok } from "@hexagen/shared";

test("POST /api/manifest/generate/spec/convert returns 400 for oversized input", async () => {
  const req = new NextRequest("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ looseSpec: "a".repeat(200001) }),
  });
  const res = await POST(req);
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.strictEqual(body.type, "error");
  assert.match(body.message, /Input too large/);
});

test("POST /api/manifest/generate/spec/convert rate limits", async () => {
  let res: Response | null = null;
  // Send 11 requests with same IP
  for (let i = 0; i < 11; i++) {
    const req = new NextRequest("http://localhost/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "1.2.3.4",
      },
      body: JSON.stringify({ looseSpec: "hello" }),
    });
    res = await POST(req);
  }
  assert.ok(res);
  assert.strictEqual(res.status, 429);
  const text = await res.text();
  assert.match(text, /Rate limit exceeded/);
  assert.strictEqual(res.headers.get("Content-Type"), "application/x-ndjson");
  assert.ok(res.headers.has("Retry-After"));
});

test("POST /api/manifest/generate/spec/convert happy path with mock", async (t) => {
  // Mock the execute method
  t.mock.method(
    ExecuteLooseSpecConversionUseCase.prototype,
    "execute",
    async (_spec, callbacks) => {
      callbacks?.onChunk?.("mock chunk");
      return ok({
        configJson: "{}",
        config: { mock: true },
      });
    },
  );

  const req = new NextRequest("http://localhost/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "1.2.3.5", // different IP
    },
    body: JSON.stringify({ looseSpec: "test spec" }),
  });

  const res = await POST(req);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get("Content-Type"), "application/x-ndjson");

  // Read the NDJSON stream
  const reader = res.body?.getReader();
  assert.ok(reader);

  const decoder = new TextDecoder();
  let resultStr = "";
  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    if (value) {
      resultStr += decoder.decode(value, { stream: true });
    }
    done = readerDone;
  }

  const events = resultStr
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(events.length >= 2);

  const chunkEvent = events.find((e) => e.type === "chunk");
  assert.ok(chunkEvent);
  assert.strictEqual(chunkEvent.data, "mock chunk");

  const doneEvent = events.find((e) => e.type === "done");
  assert.ok(doneEvent);
  assert.strictEqual(doneEvent.configJson, "{}");
});
