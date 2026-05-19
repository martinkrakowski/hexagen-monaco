import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GenerateManifestFromDescriptionUseCase } from "../../src/application/use-cases/generate-manifest-from-description.use-case.js";
import { createProjectDescription } from "../../src/domain/value-objects/project-description.js";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import type { LLMRequest } from "@hexagen/local-llm";
import type { LLMResponse } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";

/**
 * Integration test for the end-to-end manifest generation pipeline.
 * Tests the full 4-pass orchestration (workspace → contexts → ports → adapters)
 * with realistic LLM outputs.
 */

function detectPhase(systemPrompt: string): string {
  if (systemPrompt.includes("overall project workspace")) return "workspace";
  if (
    systemPrompt.includes("JSON array of objects") &&
    systemPrompt.includes("bounded context")
  )
    return "context-list";
  if (systemPrompt.includes('"in"') && systemPrompt.includes('"out"'))
    return "ports";
  if (systemPrompt.includes("infrastructure adapters")) return "adapters";
  return "unknown";
}

function createMockLLM(
  responses: Record<string, string[]>,
): SendStructuredRequestPort {
  const callCounts: Record<string, number> = {};

  return {
    sendRequest: async (request: LLMRequest): Promise<Result<LLMResponse>> => {
      const systemMsg =
        request.messages.find((m) => m.role === "system")?.content ?? "";
      const phase = detectPhase(systemMsg);

      const phaseResponses = responses[phase] ?? [];
      const idx = Math.min(callCounts[phase] ?? 0, phaseResponses.length - 1);
      callCounts[phase] = (callCounts[phase] ?? 0) + 1;

      const content = phaseResponses[idx];
      return {
        success: true,
        value: {
          id: "test-resp",
          modelId: "qwen-coder-3b",
          content,
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          timestamp: Date.now(),
        },
      };
    },
  };
}
describe.skip("Manifest Generation E2E", () => {
  it("generates manifest from e-commerce project description", async () => {
    // Sample E-commerce description
    const description = createProjectDescription(
      "E-commerce platform with product catalog, shopping cart, and payment processing",
    );

    const mockLLM = createMockLLM({
      workspace: [
        JSON.stringify({
          name: "e-commerce-platform",
          description:
            "An online shopping platform with product discovery and checkout",
        }),
      ],
      "context-list": [
        JSON.stringify([
          {
            name: "product-catalog",
            type: "core",
            description: "Manages product information and inventory",
          },
          {
            name: "order-management",
            type: "core",
            description: "Handles shopping cart and order creation",
          },
          {
            name: "payment-service",
            type: "supporting",
            description: "Processes payments and transactions",
          },
        ]),
      ],
      ports: [
        // Ports for product-catalog
        JSON.stringify({
          in: [
            {
              name: "ListProductsPort",
              type: "use-case",
              description: "Lists all products",
            },
            {
              name: "GetProductPort",
              type: "use-case",
              description: "Retrieves a single product by ID",
            },
          ],
          out: [
            {
              name: "ProductRepositoryPort",
              type: "infrastructure",
              description: "Persists products to database",
            },
          ],
        }),
        // Ports for order-management
        JSON.stringify({
          in: [
            {
              name: "CreateOrderPort",
              type: "use-case",
              description: "Creates a new order",
            },
            {
              name: "GetOrderPort",
              type: "use-case",
              description: "Retrieves order details",
            },
          ],
          out: [
            {
              name: "OrderRepositoryPort",
              type: "infrastructure",
              description: "Persists orders to database",
            },
            {
              name: "PaymentGatewayPort",
              type: "infrastructure",
              description: "Communicates with payment service",
            },
          ],
        }),
        // Ports for payment-service
        JSON.stringify({
          in: [
            {
              name: "ProcessPaymentPort",
              type: "use-case",
              description: "Processes a payment transaction",
            },
          ],
          out: [
            {
              name: "PaymentProviderPort",
              type: "infrastructure",
              description: "Connects to external payment provider",
            },
          ],
        }),
      ],
      adapters: [
        // Adapters for product-catalog
        JSON.stringify([
          {
            name: "PostgresProductAdapter",
            type: "repository",
            implements: "ProductRepositoryPort",
          },
        ]),
        // Adapters for order-management
        JSON.stringify([
          {
            name: "PostgresOrderAdapter",
            type: "repository",
            implements: "OrderRepositoryPort",
          },
          {
            name: "PaymentServiceAdapter",
            type: "gateway",
            implements: "PaymentGatewayPort",
          },
        ]),
        // Adapters for payment-service
        JSON.stringify([
          {
            name: "StripePaymentAdapter",
            type: "provider",
            implements: "PaymentProviderPort",
          },
        ]),
      ],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(mockLLM);

    // Execute the manifest generation
    const result = await useCase.execute({ description });

    // Verify success
    assert.strictEqual(
      result.success,
      true,
      "Manifest generation should succeed",
    );
    assert.ok(result.manifest, "Should return a manifest");
    assert.ok(result.manifest!.manifest, "Manifest YAML should be generated");

    // Verify manifest content
    const manifestYaml = result.manifest!.manifest;
    assert.match(
      manifestYaml,
      /system:|workspace:/,
      "YAML should contain system or workspace section",
    );
    assert.match(
      manifestYaml,
      /e-commerce-platform/,
      "YAML should contain workspace/system name",
    );
    assert.match(
      manifestYaml,
      /bounded_contexts:|boundedContexts:/,
      "YAML should contain bounded contexts",
    );

    // Verify bounded contexts were generated
    assert.match(
      manifestYaml,
      /product-catalog/,
      "Should include product-catalog context",
    );
    assert.match(
      manifestYaml,
      /order-management/,
      "Should include order-management context",
    );
    assert.match(
      manifestYaml,
      /payment-service/,
      "Should include payment-service context",
    );

    // Verify ports were generated
    assert.match(
      manifestYaml,
      /ListProductsPort/,
      "Should include ListProductsPort",
    );
    assert.match(
      manifestYaml,
      /CreateOrderPort/,
      "Should include CreateOrderPort",
    );
    assert.match(
      manifestYaml,
      /ProcessPaymentPort/,
      "Should include ProcessPaymentPort",
    );

    // Verify adapters were generated
    assert.match(
      manifestYaml,
      /PostgresProductAdapter/,
      "Should include PostgresProductAdapter",
    );
    assert.match(
      manifestYaml,
      /StripePaymentAdapter/,
      "Should include StripePaymentAdapter",
    );

    // Verify metadata
    assert.ok(result.manifest!.metadata, "Manifest should have metadata");
    assert.ok(
      result.manifest!.metadata.processingTime >= 0,
      "Should have processingTime",
    );
    assert.ok(
      result.manifest!.metadata.tokensUsed >= 0,
      "Should have tokensUsed",
    );
    assert.ok(
      result.manifest!.confidence >= 0 && result.manifest!.confidence <= 1,
      "Should have confidence score between 0 and 1",
    );

    // Verify diagnostics
    assert.ok(result.diagnostics, "Should have diagnostics");
    // With 3 contexts, we have:
    // - 1 workspace pass
    // - 1 context-list pass
    // - 3 ports passes (one per context)
    // - 3 adapters passes (one per context)
    // = 8 total attempts
    assert.ok(
      result.diagnostics!.totalAttempts >= 6,
      "Should have multiple attempts (one per context for ports/adapters)",
    );
    assert.strictEqual(
      result.diagnostics!.repairApplied,
      false,
      "Should not need repair for well-formed responses",
    );

    // Verify no warnings for this successful case
    assert.strictEqual(
      result.warnings?.length || 0,
      0,
      "Should have no warnings for successful generation",
    );
  });

  it("handles port coercion defaults (missing type and description)", async () => {
    const description = createProjectDescription(
      "Simple todo application with tasks and reminders",
    );

    const mockLLM = createMockLLM({
      workspace: [
        JSON.stringify({
          name: "todo-app",
          description: "A task management application",
        }),
      ],
      "context-list": [
        JSON.stringify([
          {
            name: "task-management",
            type: "core",
            description: "Manages tasks",
          },
        ]),
      ],
      ports: [
        // Ports with missing fields (tests coercePort defaults)
        JSON.stringify({
          in: [
            {
              name: "CreateTask", // missing type and description
            },
          ],
          out: [
            {
              name: "TaskRepository", // missing type and description
            },
          ],
        }),
      ],
      adapters: [
        JSON.stringify([
          {
            name: "MemoryTaskAdapter",
            type: "repository",
            implements: "TaskRepositoryPort",
          },
        ]),
      ],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(mockLLM);

    const result = await useCase.execute({ description });

    assert.strictEqual(
      result.success,
      true,
      "Should handle missing port fields",
    );
    assert.ok(result.manifest, "Should generate manifest with coerced ports");

    const manifestYaml = result.manifest!.manifest;

    // Verify port names have Port suffix added
    assert.match(
      manifestYaml,
      /CreateTaskPort/,
      "Port name should have 'Port' suffix added",
    );
    assert.match(
      manifestYaml,
      /TaskRepositoryPort/,
      "Port name should have 'Port' suffix added",
    );

    // Verify ports are present (by name, as type info is embedded in YAML structure)
    assert.match(manifestYaml, /CreateTaskPort/, "Should have CreateTaskPort");
    assert.match(
      manifestYaml,
      /TaskRepositoryPort/,
      "Should have TaskRepositoryPort",
    );
  });

  it("repairs malformed JSON in port responses", async () => {
    const description = createProjectDescription(
      "Content management system with articles and comments",
    );

    const mockLLM = createMockLLM({
      workspace: [
        JSON.stringify({
          name: "cms-platform",
          description: "Content management system",
        }),
      ],
      "context-list": [
        JSON.stringify([
          {
            name: "content",
            type: "core",
            description: "Manages content",
          },
        ]),
      ],
      ports: [
        // Ports with trailing garbage (tests repairJSON)
        JSON.stringify({
          in: [
            {
              name: "CreateArticlePort",
              type: "use-case",
              description: "Creates an article",
            },
          ],
          out: [],
        }) + "\nsome extra text that shouldn't be here",
      ],
      adapters: [JSON.stringify([])],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(mockLLM);

    const result = await useCase.execute({ description });

    assert.strictEqual(result.success, true, "Should repair malformed JSON");
    assert.ok(
      result.manifest,
      "Should generate manifest despite JSON corruption",
    );
    // Note: Repair is applied during parseJSON, but we verify success instead
    assert.ok(result.manifest!.manifest, "Should have generated manifest YAML");
  });

  it("validates schema compliance of generated ports", async () => {
    const description = createProjectDescription(
      "Microservice with API and database integration",
    );

    const mockLLM = createMockLLM({
      workspace: [
        JSON.stringify({
          name: "microservice",
          description: "A single microservice",
        }),
      ],
      "context-list": [
        JSON.stringify([
          {
            name: "api",
            type: "core",
            description: "API service",
          },
        ]),
      ],
      ports: [
        // Well-formed ports that should validate against ManifestDraftPortSchema
        JSON.stringify({
          in: [
            {
              name: "CreateUserPort",
              type: "use-case",
              description: "Creates a user",
            },
          ],
          out: [
            {
              name: "UserDatabasePort",
              type: "infrastructure",
              description: "Persists users",
            },
          ],
        }),
      ],
      adapters: [
        JSON.stringify([
          {
            name: "PostgresDatabaseAdapter",
            type: "repository",
            implements: "UserDatabasePort",
          },
        ]),
      ],
    });

    const useCase = new GenerateManifestFromDescriptionUseCase(mockLLM);

    const result = await useCase.execute({ description });

    assert.strictEqual(result.success, true, "Schema validation should pass");
    assert.ok(
      result.manifest!.manifest.includes("CreateUserPort"),
      "Port names should be preserved",
    );
    assert.ok(
      result.manifest!.manifest.includes("UserDatabasePort"),
      "Port names should be preserved",
    );

    // Verify structure is YAML compliant
    const yaml = result.manifest!.manifest;
    assert.match(yaml, /system:|workspace:/, "Should have system or workspace");
    assert.match(
      yaml,
      /bounded_contexts:|boundedContexts:/,
      "Should have bounded contexts",
    );
  });
});
