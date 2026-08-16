import { describe, it } from "vitest";
import assert from "node:assert";
import {
  serializeProjectContext,
  buildContextForLLM,
} from "../src/application/context-serializer";

describe("context-serializer", () => {
  it("should serialize empty context", () => {
    const emptyContext = serializeProjectContext({
      wizardData: {
        boundedContexts: [],
        externalContexts: [],
        governance: {
          workspaceName: "Test Project",
          workspaceTemplate: "modular-monolith",
          packageManager: "yarn",
          topologyStrictness: "flexible",
          namespacePrefix: "@hexagen",
          namingConventions: {
            contextDirectoryPattern: "packages/",
            adapterSuffix: ".adapter.ts",
          },
        },
        peerMappings: [],
        addOnsAnswers: {},
      },
      currentStep: "Step 1",
    });

    assert.ok(
      emptyContext.includes("Test Project"),
      "Should include project name",
    );
    assert.ok(
      emptyContext.includes("Total Bounded Contexts: 0"),
      "Should show zero contexts",
    );
  });

  it("should serialize with bounded contexts", () => {
    const withContexts = serializeProjectContext({
      wizardData: {
        boundedContexts: [
          {
            id: "ctx-1",
            name: "User Management",
            description: "Handles user auth",
            infrastructureTarget: "nestjs" as const,
            apiFramework: "NestJS" as const,
            uiFramework: "Next.js" as const,
            // Schema-defaulted fields are still required on the parsed
            // `WizardData` output type, so a hand-built fixture must supply them.
            coreDomainEntities: [],
            valueObjects: [],
            domainEvents: [],
            persistenceAdapter: "" as const,
            messagingAdapter: "" as const,
            telemetryProvider: "" as const,
            portConfiguration: {
              inboundPorts: ["rest-controller"],
              outboundPorts: ["relational-db"],
            },
          },
        ],
        externalContexts: [],
        governance: {
          workspaceName: "My App",
          workspaceTemplate: "modular-monolith",
          packageManager: "yarn",
          topologyStrictness: "flexible",
          namespacePrefix: "@hexagen",
          namingConventions: {
            contextDirectoryPattern: "packages/",
            adapterSuffix: ".adapter.ts",
          },
        },
        peerMappings: [],
        addOnsAnswers: {},
      },
      currentStep: "Step 2",
    });

    assert.ok(
      withContexts.includes("User Management"),
      "Should include context name",
    );
    assert.ok(withContexts.includes("NestJS"), "Should include framework");
  });

  it("should build context for LLM with correct structure", () => {
    const llmMessages = buildContextForLLM({
      wizardData: {
        boundedContexts: [],
        externalContexts: [],
        governance: {
          workspaceName: "Test",
          workspaceTemplate: "modular-monolith",
          packageManager: "yarn",
          topologyStrictness: "flexible",
          namespacePrefix: "@hexagen",
          namingConventions: {
            contextDirectoryPattern: "packages/",
            adapterSuffix: ".adapter.ts",
          },
        },
        peerMappings: [],
        addOnsAnswers: {},
      },
      currentStep: "Step 1",
    });

    assert.strictEqual(llmMessages.length, 1, "Should return single message");
    assert.strictEqual(
      llmMessages[0].role,
      "system",
      "Should be system message",
    );
    assert.ok(
      llmMessages[0].content.includes("HexaGen"),
      "Should include system prompt",
    );
    assert.ok(
      llmMessages[0].content.includes("Test"),
      "Should include project context",
    );
  });

  it("should serialize external contexts", () => {
    const withExternal = serializeProjectContext({
      wizardData: {
        boundedContexts: [],
        externalContexts: [
          {
            id: "ext-1",
            name: "Payment Gateway",
            relationshipType: "U" as const,
          },
        ],
        governance: {
          workspaceName: "App",
          workspaceTemplate: "modular-monolith",
          packageManager: "yarn",
          topologyStrictness: "flexible",
          namespacePrefix: "@hexagen",
          namingConventions: {
            contextDirectoryPattern: "packages/",
            adapterSuffix: ".adapter.ts",
          },
        },
        peerMappings: [],
        addOnsAnswers: {},
      },
      currentStep: "Step 1",
    });

    assert.ok(
      withExternal.includes("External Contexts"),
      "Should include external contexts section",
    );
    assert.ok(
      withExternal.includes("Payment Gateway"),
      "Should include external context name",
    );
  });

  it("should serialize peer mappings", () => {
    const withMappings = serializeProjectContext({
      wizardData: {
        boundedContexts: [],
        externalContexts: [],
        governance: {
          workspaceName: "App",
          workspaceTemplate: "modular-monolith",
          packageManager: "yarn",
          topologyStrictness: "flexible",
          namespacePrefix: "@hexagen",
          namingConventions: {
            contextDirectoryPattern: "packages/",
            adapterSuffix: ".adapter.ts",
          },
        },
        peerMappings: [
          {
            consumerContext: "Checkout",
            providerContext: "Payment",
            integrationPattern: "open-host" as const,
            communicationBoundary: "networked" as const,
          },
        ],
        addOnsAnswers: {},
      },
      currentStep: "Step 1",
    });

    assert.ok(
      withMappings.includes("Peer Mappings"),
      "Should include peer mappings section",
    );
    assert.ok(withMappings.includes("Checkout"), "Should include consumer");
    assert.ok(withMappings.includes("Payment"), "Should include provider");
  });
});
