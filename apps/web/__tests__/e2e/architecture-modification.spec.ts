import { test, expect } from "@playwright/test";

test.describe("Architecture Modification SSE Endpoint", () => {
  test("returns SSE-formatted error for invalid JSON", async ({ request }) => {
    const response = await request.post("/api/architecture/modify/stream", {
      headers: {
        "Content-Type": "application/json",
      },
      data: "not json",
    });

    expect(response.status()).toBe(400);
    const text = await response.text();
    expect(text).toMatch(/^data: .+\n\n$/);
    const data = JSON.parse(text.replace(/^data: /, "").replace(/\n\n$/, ""));
    expect(data.type).toBe("error");
  });

  test("returns SSE-formatted error when intent is missing", async ({
    request,
  }) => {
    const response = await request.post("/api/architecture/modify/stream", {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({}),
    });

    expect(response.status()).toBe(400);
    const text = await response.text();
    expect(text).toMatch(/^data: .+\n\n$/);
    const data = JSON.parse(text.replace(/^data: /, "").replace(/\n\n$/, ""));
    expect(data.type).toBe("error");
    expect(data.message).toContain("intent");
  });

  test("returns SSE stream with step_running events", async ({ request }) => {
    const response = await request.post("/api/architecture/modify/stream", {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ intent: "Add a bounded context named billing" }),
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/event-stream");

    const text = await response.text();
    expect(text).toContain("step_running");
  });

  test("stream contains pipeline_complete or pipeline_error event", async ({
    request,
  }) => {
    const response = await request.post("/api/architecture/modify/stream", {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ intent: "Add a bounded context named billing" }),
    });

    expect(response.status()).toBe(200);
    const text = await response.text();

    const hasComplete = text.includes("pipeline_complete");
    const hasError = text.includes("pipeline_error");
    expect(hasComplete || hasError).toBe(true);
  });
});

test.describe("Architecture Modification POST Endpoint", () => {
  test("returns 400 when intent is missing", async ({ request }) => {
    const response = await request.post("/api/architecture/modify", {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({}),
    });

    expect(response.status()).toBe(400);
  });

  test("accept endpoint exists and returns structure", async ({ request }) => {
    const response = await request.post("/api/architecture/modify/accept", {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        transactionId: "test-txn",
        patches: [],
      }),
    });

    expect(response.status()).toBeGreaterThanOrEqual(200);
    const json = await response.json();
    expect(json).toHaveProperty("success");
    expect(json).toHaveProperty("transactionId");
  });

  test("reject endpoint exists and returns structure", async ({ request }) => {
    const response = await request.post("/api/architecture/modify/reject", {
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        transactionId: "test-txn",
        reason: "Test rejection",
      }),
    });

    expect(response.status()).toBeGreaterThanOrEqual(200);
    const json = await response.json();
    expect(json).toHaveProperty("success");
    expect(json).toHaveProperty("transactionId");
  });
});
