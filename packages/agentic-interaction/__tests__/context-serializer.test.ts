import assert from "node:assert";
import {
  serializeProjectContext,
  buildContextForLLM,
} from "../src/application/context-serializer.js";

(async () => {
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
  console.log("✅ Test 1: serialize empty context - passed");

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
    },
    currentStep: "Step 2",
  });

  assert.ok(
    withContexts.includes("User Management"),
    "Should include context name",
  );
  assert.ok(withContexts.includes("NestJS"), "Should include framework");
  console.log("✅ Test 2: serialize with bounded contexts - passed");

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
    },
    currentStep: "Step 1",
  });

  assert.strictEqual(llmMessages.length, 1, "Should return single message");
  assert.strictEqual(llmMessages[0].role, "system", "Should be system message");
  assert.ok(
    llmMessages[0].content.includes("HexaGen"),
    "Should include system prompt",
  );
  assert.ok(
    llmMessages[0].content.includes("Test"),
    "Should include project context",
  );
  console.log(
    "✅ Test 3: buildContextForLLM returns correct structure - passed",
  );

  const withExternal = serializeProjectContext({
    wizardData: {
      boundedContexts: [],
      externalContexts: [
        {
          id: "ext-1",
          name: "Payment Gateway",
          relationshipType: "upstream" as const,
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
  console.log("✅ Test 4: external contexts serialized - passed");

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
    },
    currentStep: "Step 1",
  });

  assert.ok(
    withMappings.includes("Peer Mappings"),
    "Should include peer mappings section",
  );
  assert.ok(withMappings.includes("Checkout"), "Should include consumer");
  assert.ok(withMappings.includes("Payment"), "Should include provider");
  console.log("✅ Test 5: peer mappings serialized - passed");

  console.log("✅ All context serializer tests passed.");
})();
