import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("POST /api/architecture/modify/accept", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 400 if transactionId is missing", async () => {
    const { POST } =
      await import("../../../app/api/architecture/modify/accept/route.js");
    const mockRequest = new Request(
      "http://localhost:3000/api/architecture/modify/accept",
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

  it("should return success for valid accept request", async () => {
    const { POST } =
      await import("../../../app/api/architecture/modify/accept/route.js");
    const mockRequest = new Request(
      "http://localhost:3000/api/architecture/modify/accept",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: "txn-123",
          patches: [{ type: "add", path: "test", content: "content" }],
        }),
      },
    );
    const response = await POST(mockRequest);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.transactionId).toBe("txn-123");
    expect(body.status).toBe("accepted");
  });

  it("should handle patches array in request", async () => {
    const { POST } =
      await import("../../../app/api/architecture/modify/accept/route.js");
    const mockRequest = new Request(
      "http://localhost:3000/api/architecture/modify/accept",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: "txn-456",
          patches: [
            { type: "modify", path: "file1.txt", content: "new content" },
            { type: "delete", path: "file2.txt" },
          ],
        }),
      },
    );
    const response = await POST(mockRequest);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });
});
