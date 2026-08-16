import { describe, it, test } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseStructuredConfig,
  StructuredConfigShapeError,
  buildDomainAnalysisFromConfig,
  buildClassificationFromConfig,
  buildContextMappingsFromConfig,
  deriveOutboundPortsFromConfig,
  ExecuteStructuredConfigGenerationUseCase,
  inferContextType,
  StructuredConfigContext,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const yamlPath = path.join(fixturesDir, "krakowski-portal.yaml");
const jsonPath = path.join(fixturesDir, "krakowski-portal.json");

test("parseStructuredConfig: valid YAML returns StructuredConfig with 7 contexts", () => {
  const yaml = fs.readFileSync(yamlPath, "utf-8");
  const config = parseStructuredConfig(yaml);
  assert.strictEqual(config.bounded_contexts.length, 7);
  assert.strictEqual(config.project, "krakowski-portal");
});

test("parseStructuredConfig: valid JSON equivalent returns same result as YAML", () => {
  const yaml = fs.readFileSync(yamlPath, "utf-8");
  const json = fs.readFileSync(jsonPath, "utf-8");
  const yamlConfig = parseStructuredConfig(yaml);
  const jsonConfig = parseStructuredConfig(json);
  assert.strictEqual(
    yamlConfig.bounded_contexts.length,
    jsonConfig.bounded_contexts.length,
  );
  assert.strictEqual(yamlConfig.project, jsonConfig.project);
});

test("parseStructuredConfig: YAML with missing bounded_contexts throws StructuredConfigShapeError", () => {
  const invalidYaml = "project: test";
  assert.throws(
    () => parseStructuredConfig(invalidYaml),
    StructuredConfigShapeError,
  );
});

test("parseStructuredConfig: empty bounded_contexts throws StructuredConfigShapeError", () => {
  const invalidYaml = "project: test\nbounded_contexts: []";
  assert.throws(
    () => parseStructuredConfig(invalidYaml),
    StructuredConfigShapeError,
  );
});

test("parseStructuredConfig: completely invalid YAML throws descriptive error", () => {
  const invalidYaml = "{{ invalid yaml {{";
  assert.throws(() => parseStructuredConfig(invalidYaml), /Failed to parse/);
});

test("parseStructuredConfig: YAML without YAML prefix (JSON string) parsed as YAML", () => {
  const jsonString =
    '{"project": "test", "bounded_contexts": [{"name": "Test", "type": "core"}]}';
  const config = parseStructuredConfig(jsonString);
  assert.strictEqual(config.project, "test");
  assert.strictEqual(config.bounded_contexts.length, 1);
});

test("parseStructuredConfig: multi-document YAML with disjoint top-level keys merges", () => {
  const multiDoc = `project: krakowski-portal
---
apps:
  - name: web
    framework: nextjs
---
bounded_contexts:
  - name: IdentityAccess
    type: core
`;
  const config = parseStructuredConfig(multiDoc);
  assert.strictEqual(config.project, "krakowski-portal");
  assert.strictEqual(config.apps?.length, 1);
  assert.strictEqual(config.apps?.[0].name, "web");
  assert.strictEqual(config.bounded_contexts.length, 1);
  assert.strictEqual(config.bounded_contexts[0].name, "IdentityAccess");
});

test("parseStructuredConfig: multi-document YAML where first doc has bounded_contexts", () => {
  const multiDoc = `bounded_contexts:
  - name: First
    type: core
---
apps:
  - name: web
`;
  const config = parseStructuredConfig(multiDoc);
  assert.strictEqual(config.bounded_contexts.length, 1);
  assert.strictEqual(config.apps?.length, 1);
});

test("parseStructuredConfig: multi-document YAML with conflicting top-level keys throws", () => {
  const conflicting = `project: foo
bounded_contexts:
  - name: A
    type: core
---
project: bar
`;
  // Refusing to silently override is safer than picking a winner.
  assert.throws(
    () => parseStructuredConfig(conflicting),
    /Failed to parse|StructuredConfigShapeError/,
  );
});

test("parseStructuredConfig: multi-document YAML where no doc has bounded_contexts throws", () => {
  const noContexts = `project: foo
---
apps:
  - name: web
`;
  assert.throws(
    () => parseStructuredConfig(noContexts),
    StructuredConfigShapeError,
  );
});

describe("deriveOutboundPortsFromConfig", () => {
  const baseConfig = parseStructuredConfig(`
bounded_contexts:
  - name: IdentityAccess
    type: core
    aggregates:
      - name: User
        root: true
    events_published:
      - UserRegistered
      - UserRoleChanged
  - name: NotificationDelivery
    type: supporting
    aggregates:
      - name: Notification
        root: true
    value_objects:
      - name: DeliveryChannel
        underlying: enum
        values: [email, in_app]
  - name: ProjectDelivery
    type: core
    aggregates:
      - name: Project
        root: true
      - name: Milestone
        root: false
        parent: Project
  - name: Empty
    type: generic
`);

  it("derives one repository port per aggregate root", () => {
    const ports = deriveOutboundPortsFromConfig(baseConfig, "ProjectDelivery");
    const repoPorts = ports.filter((p) => p.type === "repository");
    // Project (root) gets a repo; Milestone (root:false) does not.
    assert.strictEqual(repoPorts.length, 1);
    assert.strictEqual(repoPorts[0].name, "ProjectRepositoryPort");
    assert.strictEqual(repoPorts[0].forAggregate, "Project");
  });

  it("adds a publisher port when events_published is non-empty", () => {
    const ports = deriveOutboundPortsFromConfig(baseConfig, "IdentityAccess");
    const pub = ports.find((p) => p.type === "publisher");
    assert.ok(pub, "expected a publisher port");
    assert.strictEqual(pub.name, "UserEventPublisherPort");
    assert.match(pub.description, /UserRegistered/);
  });

  it("omits the publisher port when events_published is empty", () => {
    const ports = deriveOutboundPortsFromConfig(
      baseConfig,
      "NotificationDelivery",
    );
    assert.strictEqual(ports.filter((p) => p.type === "publisher").length, 0);
  });

  it("derives one notifier port per channel enum value (DeliveryChannel)", () => {
    const ports = deriveOutboundPortsFromConfig(
      baseConfig,
      "NotificationDelivery",
    );
    const notifiers = ports.filter((p) => p.type === "notifier");
    assert.deepStrictEqual(notifiers.map((p) => p.name).sort(), [
      "EmailNotifierPort",
      "InAppNotifierPort",
    ]);
  });

  it("returns the full expected port set for notification-delivery", () => {
    const ports = deriveOutboundPortsFromConfig(
      baseConfig,
      "NotificationDelivery",
    );
    // 1 repository (Notification) + 0 publishers + 2 notifiers (email, in_app)
    assert.strictEqual(ports.length, 3);
    assert.deepStrictEqual(ports.map((p) => p.name).sort(), [
      "EmailNotifierPort",
      "InAppNotifierPort",
      "NotificationRepositoryPort",
    ]);
  });

  it("returns [] for contexts with no aggregates, no events, no channels", () => {
    const ports = deriveOutboundPortsFromConfig(baseConfig, "Empty");
    assert.deepStrictEqual(ports, []);
  });

  it("returns [] for an unknown context name", () => {
    const ports = deriveOutboundPortsFromConfig(baseConfig, "DoesNotExist");
    assert.deepStrictEqual(ports, []);
  });
});

test("parseStructuredConfig: large input (50,000 chars) returns result within 1000ms", () => {
  const baseYaml =
    "project: large-test\nbounded_contexts:\n  - name: TestContext\n    type: core\n";
  const padding = " ".repeat(50000 - baseYaml.length);
  const largeYaml = baseYaml + padding;
  const start = Date.now();
  const config = parseStructuredConfig(largeYaml);
  const duration = Date.now() - start;
  assert.strictEqual(config.bounded_contexts.length, 1);
  assert.ok(duration <= 1000, `Took ${duration}ms, expected <=1000ms`);
});

// P18.3: buildDomainAnalysisFromConfig tests
describe("buildDomainAnalysisFromConfig with krakowski fixture", () => {
  const yaml = fs.readFileSync(yamlPath, "utf-8");
  const krakowskiConfig = parseStructuredConfig(yaml);
  const result = buildDomainAnalysisFromConfig(krakowskiConfig);

  it("produces 7 subdomains", () => {
    assert.strictEqual(result.subdomains.length, 7);
  });

  it("identifies User as aggregate root in IdentityAccess", () => {
    const ar = (result as any).aggregateRoots.find(
      (a: any) => a.name === "User",
    );
    assert.strictEqual(ar?.subdomain, "IdentityAccess");
    assert.ok(ar?.identityFields?.includes("id"));
  });

  it("identifies OnboardingState as entity in CustomerOnboarding", () => {
    const e = (result as any).entities.find(
      (e: any) => e.name === "OnboardingState",
    );
    assert.strictEqual(e?.parentAggregate, "Customer");
  });

  it("produces value objects with rules", () => {
    const money = (result as any).valueObjects.find(
      (vo: any) => vo.name === "Money",
    );
    assert.ok(money);
  });

  it("produces InvoicePaid as a domain event emitted by InvoicingBilling", () => {
    const ev = (result as any).domainEvents.find(
      (e: any) => e.name === "InvoicePaid",
    );
    assert.strictEqual(ev?.emitter, "InvoicingBilling");
  });

  it("produces use cases with actor information", () => {
    const uc = (result as any).useCases.find(
      (uc: any) => uc.name === "RegisterUser",
    );
    assert.strictEqual(uc?.actor, "system");
    assert.strictEqual(uc?.subdomain, "IdentityAccess");
  });
});

// P18.4: buildClassificationFromConfig tests
describe("buildClassificationFromConfig with krakowski fixture", () => {
  const yaml = fs.readFileSync(yamlPath, "utf-8");
  const krakowskiConfig = parseStructuredConfig(yaml);
  const analysis = buildDomainAnalysisFromConfig(krakowskiConfig);
  const result = buildClassificationFromConfig(krakowskiConfig, analysis);

  it("produces 7 accepted contexts", () => {
    assert.strictEqual(result.accepted.length, 7);
    assert.strictEqual(result.rejected.length, 0);
    assert.strictEqual(result.uncertain.length, 0);
  });

  it("classifies NotificationDelivery as supporting", () => {
    const ctx = result.accepted.find(
      (c: any) => c.name === "NotificationDelivery",
    );
    assert.strictEqual(ctx?.type, "supporting");
  });

  it("classifies InvoicingBilling as core", () => {
    const ctx = result.accepted.find((c: any) => c.name === "InvoicingBilling");
    assert.strictEqual(ctx?.type, "core");
  });

  it("populates responsibility from config", () => {
    const ctx = result.accepted.find((c: any) => c.name === "ProjectDelivery");
    assert.ok(ctx?.responsibility?.includes("Project lifecycle"));
  });

  it("populates aggregateRoots for InvoicingBilling", () => {
    const ctx = result.accepted.find((c: any) => c.name === "InvoicingBilling");
    assert.ok(ctx?.aggregateRoots?.includes("Invoice"));
  });

  it("populates eventsPublished", () => {
    const ctx = result.accepted.find(
      (c: any) => c.name === "PaymentProcessing",
    );
    assert.ok(ctx?.eventsPublished?.includes("PaymentReceived"));
  });
});

// P18.5: buildContextMappingsFromConfig tests
describe("buildContextMappingsFromConfig with krakowski fixture", () => {
  const yaml = fs.readFileSync(yamlPath, "utf-8");
  const krakowskiConfig = parseStructuredConfig(yaml);

  it("produces 14 context mappings for krakowski", () => {
    const mappings = buildContextMappingsFromConfig(krakowskiConfig);
    assert.strictEqual(mappings.length, 14);
  });

  it("preserves pattern and mechanism", () => {
    const krakowskiConfig = parseStructuredConfig(
      fs.readFileSync(yamlPath, "utf-8"),
    );
    const mapping = buildContextMappingsFromConfig(krakowskiConfig).find(
      (m: any) =>
        m.upstream === "Stripe" && m.downstream === "PaymentProcessing",
    );
    assert.strictEqual(mapping?.pattern, "OHS_ACL");
    assert.strictEqual(mapping?.mechanism, "webhook");
  });
});

describe("ExecuteStructuredConfigGenerationUseCase", () => {
  const validYaml = fs.readFileSync(yamlPath, "utf-8");

  const mockLLMAdapter = {
    sendRequest: async () => ({
      success: true as const,
      value: {
        id: "test-response-1",
        modelId: "qwen-coder-3b" as any,
        content: JSON.stringify({ type: "result", passed: true }),
        finishReason: "stop" as const,
        timestamp: Date.now(),
      },
    }),
    streamStructuredRequest: async function* () {
      yield {
        success: true,
        value: JSON.stringify({ type: "result", passed: true }),
      };
    },
  } as any;

  const mockTransactionManager = {
    begin: async (intentId: string) => ({
      id: `txn-${intentId}`,
      intentId,
      status: "pending" as const,
    }),
    transition: async () => {},
    get: async () => null,
    list: async () => [],
    commit: async () => {},
    rollback: async () => {},
  } as any;

  test("fails with invalid YAML", async () => {
    const invalidYaml = "not: valid: yaml: [";
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      mockLLMAdapter,
      mockTransactionManager,
    );
    const result = await useCase.execute(invalidYaml);
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("fails with missing bounded_contexts", async () => {
    const yamlWithoutContexts = "projectName: test";
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      mockLLMAdapter,
      mockTransactionManager,
    );
    const result = await useCase.execute(yamlWithoutContexts);
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error instanceof Error &&
        result.error.message.includes("bounded_contexts"),
    );
  });

  test("fails when LLM fails during Stage 3", async () => {
    let callCount = 0;
    const failAtStage3Adapter = {
      streamStructuredRequest: async function* () {
        callCount++;
        if (callCount >= 3) {
          yield { success: false, error: "LLM failure at Stage 3" };
          return;
        }
        yield { success: true, value: JSON.stringify({}) };
      },
      sendRequest: async () => ({
        success: false,
        error: new Error("LLM failure at Stage 3"),
      }),
    } as any;

    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      failAtStage3Adapter,
      mockTransactionManager,
    );
    const result = await useCase.execute(validYaml);
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test("returns result on repeated execution", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      mockLLMAdapter,
      mockTransactionManager,
    );
    const result1 = await useCase.execute(validYaml);
    assert.strictEqual(result1.success, true);
    const result2 = await useCase.execute(validYaml);
    assert.strictEqual(result2.success, true);
  });
});

describe("inferContextType — heuristic edge cases (Phase 1 Heuristic)", () => {
  const ctx = (name: string, responsibility: string) =>
    ({
      name,
      responsibility,
      aggregates: [],
    }) as unknown as StructuredConfigContext;

  it("'shared files' must NOT be shared-kernel", () => {
    assert.strictEqual(
      inferContextType(
        ctx(
          "DocumentVault",
          "Contracts, shared files, scoped Supabase Storage",
        ),
      ),
      "supporting",
    );
  });

  // PRESERVED — phrase-level matches must continue to work
  it("'Shared Kernel for X' classifies as shared-kernel", () => {
    assert.strictEqual(
      inferContextType(
        ctx("BillingTerms", "Shared Kernel for billing terminology"),
      ),
      "shared-kernel",
    );
  });

  it("'Cross-cutting concerns' classifies as shared-kernel", () => {
    assert.strictEqual(
      inferContextType(ctx("CrossCutting", "Cross-cutting concerns")),
      "shared-kernel",
    );
  });

  it("bare 'common utilities' falls through to 'core' (default)", () => {
    assert.strictEqual(
      inferContextType(ctx("Utilities", "Common utilities module")),
      "core",
    );
  });

  it("literal 'shared-kernel' classifies as shared-kernel", () => {
    assert.strictEqual(
      inferContextType(ctx("CoreShared", "shared-kernel context")),
      "shared-kernel",
    );
  });

  it("literal 'shared_kernel' classifies as shared-kernel", () => {
    assert.strictEqual(
      inferContextType(ctx("CoreShared2", "shared_kernel context")),
      "shared-kernel",
    );
  });
});
