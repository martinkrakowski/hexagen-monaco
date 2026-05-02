import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GenerateTopologyToolUseCase } from "../../src/application/use-cases/generate-topology-tool.use-case.js";
import { GenerateAdaptersToolUseCase } from "../../src/application/use-cases/generate-adapters-tool.use-case.js";
import { GenerateManifestPipelineToolUseCase } from "../../src/application/use-cases/generate-manifest-pipeline-tool.use-case.js";
import type { ManifestGenerationPort } from "../../src/application/ports/out/manifest-generation.port.js";
const stubTopology = {
  workspace: { name: "test-app", description: "A test app" },
  boundedContexts: [
    {
      name: "order-management",
      type: "core" as const,
      description: "Order management context",
      ports: {
        in: [
          {
            name: "CreateOrderPort",
            type: "command",
            description: "Creates orders",
          },
        ],
        out: [
          {
            name: "NotificationPort",
            type: "gateway",
            description: "Sends notifications",
          },
        ],
      },
    },
  ],
};

const stubPort: ManifestGenerationPort = {
  generateTopology: async () => ({
    topology: stubTopology,
    clarificationTriggers: [],
  }),
  generateAdapters: async () => ({
    adapters: [
      {
        name: "PostgresOrderRepositoryAdapter",
        type: "repository",
        implements: "CreateOrderPort",
      },
    ],
  }),
  generateManifestPipeline: async () => ({
    dryRun: false,
    yaml: "system: test-app\nscope: test\narchitecture: modular-monolith\nbounded_contexts: []\napps: []",
    contextCount: 1,
    totalPorts: 2,
    totalAdapters: 1,
    diagnostics: [],
    registeredInManifest: true,
  }),
};

describe("GenerateTopologyToolUseCase", () => {
  it("throws if description is empty", async () => {
    const uc = new GenerateTopologyToolUseCase(stubPort);
    await assert.rejects(() => uc.execute({ description: "" }), {
      message: "description is required",
    });
  });

  it("throws if description is whitespace", async () => {
    const uc = new GenerateTopologyToolUseCase(stubPort);
    await assert.rejects(() => uc.execute({ description: "   " }), {
      message: "description is required",
    });
  });

  it("delegates to port and returns topology", async () => {
    const uc = new GenerateTopologyToolUseCase(stubPort);
    const result = await uc.execute({
      description: "An order management system",
    });
    assert.strictEqual(result.topology.workspace.name, "test-app");
    assert.strictEqual(result.clarificationTriggers.length, 0);
  });
});

describe("GenerateAdaptersToolUseCase", () => {
  it("throws if contextName is empty", async () => {
    const uc = new GenerateAdaptersToolUseCase(stubPort);
    await assert.rejects(
      () => uc.execute({ contextName: "", portNames: ["Port1"] }),
      { message: "contextName is required" },
    );
  });

  it("returns empty adapters if no ports", async () => {
    const uc = new GenerateAdaptersToolUseCase(stubPort);
    const result = await uc.execute({ contextName: "test", portNames: [] });
    assert.deepStrictEqual(result.adapters, []);
  });

  it("delegates to port and returns adapters", async () => {
    const uc = new GenerateAdaptersToolUseCase(stubPort);
    const result = await uc.execute({
      contextName: "order-management",
      portNames: ["CreateOrderPort"],
    });
    assert.strictEqual(result.adapters.length, 1);
    assert.strictEqual(result.adapters[0].implements, "CreateOrderPort");
  });
});

describe("GenerateManifestPipelineToolUseCase", () => {
  it("throws if description is empty", async () => {
    const uc = new GenerateManifestPipelineToolUseCase(stubPort);
    await assert.rejects(() => uc.execute({ description: "  " }), {
      message: "description is required",
    });
  });

  it("delegates to port and returns pipeline result", async () => {
    const uc = new GenerateManifestPipelineToolUseCase(stubPort);
    const result = await uc.execute({
      description: "An order management system",
    });
    assert.strictEqual(result.dryRun, false);
    assert.strictEqual(result.contextCount, 1);
    assert.strictEqual(result.totalPorts, 2);
    assert.strictEqual(result.totalAdapters, 1);
    assert.strictEqual(result.registeredInManifest, true);
  });
});
