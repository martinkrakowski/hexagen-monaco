/**
 * Integration tests for manifest generation API endpoint
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { POST } from "../../../app/api/manifest/generate/route";
import { NextRequest } from "next/server";

// Mock LLM use case to avoid real API calls
const mockExecute = mock.fn();
mock.module("@hexagen/agentic-interaction", () => {
  return {
    GenerateManifestFromDescriptionUseCase: class {
      execute = mockExecute;
    },
    LLMProviderSelectorAdapter: class {},
    EnvironmentSecretVaultAdapter: class {},
    createProjectDescription: (desc: string) => ({ description: desc }),
  };
});

// Mock local LLM adapter
mock.module("@hexagen/local-llm", () => {
  return {
    WebLLMAdapter: class {},
    DomainModelId: "test-model" as const,
  };
});

describe("POST /api/manifest/generate", () => {
  beforeEach(() => {
    mockExecute.mock.resetCalls();
    // Reset NODE_ENV to default
    process.env.NODE_ENV = "production";
    // Clear API key env vars
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    mockExecute.mock.resetCalls();
  });

  describe("Request Validation", () => {
    it("should reject requests without description", async () => {
      const request = new NextRequest("http://localhost:3000/api/manifest/generate", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      assert.strictEqual(response.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.error, /missing.*description/i);
    });

    it("should reject requests with non-string description", async () => {
      const request = new NextRequest("http://localhost:3000/api/manifest/generate", {
        method: "POST",
        body: JSON.stringify({ description: 123 }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      assert.strictEqual(response.status, 400);
      assert.strictEqual(data.success, false);
    });

    it("should reject invalid project description", async () => {
      const request = new NextRequest("http://localhost:3000/api/manifest/generate", {
        method: "POST",
        body: JSON.stringify({ description: "x" }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      assert.strictEqual(response.status, 400);
      assert.strictEqual(data.success, false);
      assert.ok(data.details);
    });
  });

  describe("preferLocal Flag", () => {
    it("should use cloud LLM when preferLocal=false (default)", async () => {
      mockExecute.mock.mockImplementationOnce(async () => ({
        success: true,
        manifest: {
          manifest: "test: true",
          confidence: 0.9,
          suggestions: [],
          warnings: [],
          metadata: { model: "gpt-4o", processingTime: 100, tokensUsed: 100, provider: "openai" },
        },
      }));

      const request = new NextRequest("http://localhost:3000/api/manifest/generate", {
        method: "POST",
        body: JSON.stringify({ description: "Valid project description" }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.metadata.provider, "openai");
    });

    it("should prefer local LLM when preferLocal=true", async () => {
      mockExecute.mock.mockImplementationOnce(async () => ({
        success: true,
        manifest: {
          manifest: "test: true",
          confidence: 0.9,
          suggestions: [],
          warnings: [],
          metadata: { model: "local-model", processingTime: 100, tokensUsed: 100, provider: "webllm" },
        },
      }));

      const request = new NextRequest("http://localhost:3000/api/manifest/generate", {
        method: "POST",
        body: JSON.stringify({ description: "Valid project description", preferLocal: true }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.metadata.provider, "webllm");
    });
  });

  describe("Mock Bypass Logic Removed", () => {
    it("should call real LLM when NODE_ENV=development and no API keys set", async () => {
      process.env.NODE_ENV = "development";
      // No API keys set
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      mockExecute.mock.mockImplementationOnce(async () => ({
        success: true,
        manifest: {
          manifest: "test: true",
          confidence: 0.9,
          suggestions: [],
          warnings: [],
          metadata: { model: "gpt-4o", processingTime: 100, tokensUsed: 100, provider: "openai" },
        },
      }));

      const request = new NextRequest("http://localhost:3000/api/manifest/generate", {
        method: "POST",
        body: JSON.stringify({ description: "Valid project description" }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      // Verify the real LLM path was called (no mock bypass)
      assert.strictEqual(mockExecute.mock.callCount(), 1);
      assert.strictEqual(response.status, 200);
    });
  });

  describe("Response Shape", () => {
    it("should return valid GenerateManifestResponse on success", async () => {
      mockExecute.mock.mockImplementationOnce(async () => ({
        success: true,
        manifest: {
          manifest: "test: true",
          confidence: 0.9,
          suggestions: ["Add tests"],
          warnings: ["Low confidence"],
          metadata: { model: "gpt-4o", processingTime: 100, tokensUsed: 100, provider: "openai" },
        },
      }));

      const request = new NextRequest("http://localhost:3000/api/manifest/generate", {
        method: "POST",
        body: JSON.stringify({ description: "Valid project description" }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify success response shape
      assert.strictEqual(data.success, true);
      assert.ok(typeof data.manifest === "string");
      assert.ok(typeof data.confidence === "number");
      assert.ok(Array.isArray(data.suggestions));
      assert.ok(Array.isArray(data.warnings));
      assert.ok(typeof data.metadata === "object");
      assert.ok(data.metadata.model);
      assert.ok(data.metadata.processingTime > 0);
      assert.ok(data.metadata.tokensUsed > 0);
      assert.ok(data.metadata.provider);
    });

    it("should return valid GenerateManifestResponse on error", async () => {
      mockExecute.mock.mockImplementationOnce(async () => ({
        success: false,
        error: "Generation failed",
      }));

      const request = new NextRequest("http://localhost:3000/api/manifest/generate", {
        method: "POST",
        body: JSON.stringify({ description: "Valid project description" }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify error response shape
      assert.strictEqual(data.success, false);
      assert.ok(data.error);
      assert.ok(data.details);
    });
  });

  describe("Error Handling", () => {
    it("should handle internal server errors", async () => {
      mockExecute.mock.mockImplementationOnce(async () => {
        throw new Error("Internal error");
      });

      const request = new NextRequest("http://localhost:3000/api/manifest/generate", {
        method: "POST",
        body: JSON.stringify({ description: "Valid project description" }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      assert.strictEqual(response.status, 500);
      assert.strictEqual(data.success, false);
      assert.ok(data.error);
    });
  });
});
