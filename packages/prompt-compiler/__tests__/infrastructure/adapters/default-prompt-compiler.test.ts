import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import { DefaultPromptCompilerAdapter } from "../../../src/infrastructure/adapters/default-prompt-compiler.adapter";
import type { ProjectSpec } from "@hexagen/project-configuration";
import type { ArchitectureGraph } from "@hexagen/visualization";
import type { LinterReport } from "@hexagen/governance";
import type { PromptCompileRequest } from "../../../src/application/ports/in/prompt-compiler.port";

const makeManifest = (): ProjectSpec => ({
  boundedContexts: [
    {
      id: "ctx-0",
      name: "OrderContext",
      coreDomainEntities: [],
      valueObjects: [],
      domainEvents: [],
      portConfiguration: { inboundPorts: [], outboundPorts: [] },
      uiFramework: "",
      persistenceAdapter: "",
      messagingAdapter: "",
      telemetryProvider: "",
    },
  ],
  externalContexts: [],
  governance: {
    workspaceName: "@hexagen",
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
});

const makeArchitectureGraph = (): ArchitectureGraph => ({
  nodes: [],
  edges: [],
});

const makeLinterReport = (): LinterReport => ({
  timestamp: new Date().toISOString(),
  isCompliant: true,
  violations: [],
  scannedFilesCount: 0,
});

const makeRequest = (
  overrides: Partial<PromptCompileRequest> = {},
): PromptCompileRequest => ({
  name: "test",
  manifest: makeManifest(),
  architectureGraph: makeArchitectureGraph(),
  linterReport: makeLinterReport(),
  userIntent: "Add an Order entity",
  ...overrides,
});

describe("DefaultPromptCompilerAdapter", () => {
  let adapter: DefaultPromptCompilerAdapter;

  beforeEach(() => {
    adapter = new DefaultPromptCompilerAdapter();
  });

  describe("compile()", () => {
    it("should create a prompt template from a request", async () => {
      const template = await adapter.compile(
        makeRequest({ name: "add-entity" }),
      );

      assert.strictEqual(template.name, "add-entity");
      assert.ok(template.systemPrompt !== undefined);
      assert.ok(template.systemPrompt.length > 0);
      assert.ok(template.userPromptTemplate !== undefined);
      assert.ok(template.variables.length > 0);
    });

    it("should include manifest as a variable", async () => {
      const template = await adapter.compile(makeRequest());

      const manifestVar = template.variables.find((v) => v.name === "manifest");
      assert.ok(manifestVar !== undefined);
    });

    it("should include architectureGraph as a variable", async () => {
      const template = await adapter.compile(makeRequest());

      const graphVar = template.variables.find(
        (v) => v.name === "architectureGraph",
      );
      assert.ok(graphVar !== undefined);
    });

    it("should include linterReport as a variable", async () => {
      const template = await adapter.compile(makeRequest());

      const reportVar = template.variables.find(
        (v) => v.name === "linterReport",
      );
      assert.ok(reportVar !== undefined);
    });
  });

  describe("render()", () => {
    it("should render a template with variable substitution", async () => {
      const template = await adapter.compile(makeRequest());

      const rendered = adapter.render(template);

      assert.ok(rendered.systemPrompt !== undefined);
      assert.ok(rendered.userPrompt !== undefined);
      assert.ok(rendered.variables !== undefined);
    });
  });
});
