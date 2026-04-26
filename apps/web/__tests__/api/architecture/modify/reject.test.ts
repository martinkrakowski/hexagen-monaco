import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("POST /api/architecture/modify/reject", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 400 if transactionId is missing", async () => {
    const { POST } =
      await import("../../../app/api/architecture/modify/reject/route.js");
    const mockRequest = new Request(
      "http://localhost:3000/api/architecture/modify/reject",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const response = await POST(mockRequest);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("transactionId is required");
  });

  it("should return success for valid reject request", async () => {
    const { POST } =
      await import("../../../app/api/architecture/modify/reject/route.js");
    const mockRequest = new Request(
      "http://localhost:3000/api/architecture/modify/reject",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: "txn-123",
          patches: [{ type: "add", path: "test", content: "content" }],
          reason: "User rejected the changes",
        }),
      },
    );
    const response = await POST(mockRequest);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.transactionId).toBe("txn-123");
    expect(body.status).toBe("rejected");
    expect(body.reason).toBe("User rejected the changes");
  });

  it("should use default reason if not provided", async () => {
    const { POST } =
      await import("../../../app/api/architecture/modify/reject/route.js");
    const mockRequest = new Request(
      "http://localhost:3000/api/architecture/modify/reject",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: "txn-789",
          patches: [],
        }),
      },
    );
    const response = await POST(mockRequest);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.reason).toBe("User rejected the changes");
  });
});
