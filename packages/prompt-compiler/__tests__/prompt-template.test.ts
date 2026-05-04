import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPromptTemplate,
  renderPrompt,
} from "../src/domain/prompt-template";
import type { PromptContext } from "../src/domain/prompt-template";
import type { ProjectSpec } from "@hexagen/project-configuration";
import type { ArchitectureGraph } from "@hexagen/visualization";
import type { LinterReport } from "@hexagen/governance";

const makeManifest = (): ProjectSpec => ({
  boundedContexts: [
    {
      id: "ctx-0",
      name: "OrderContext",
      coreDomainEntities: [],
      valueObjects: [],
      domainEvents: [],
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
});

const makeContext = (): PromptContext => ({
  manifest: makeManifest(),
  architectureGraph: {
    nodes: [],
    edges: [],
  } as ArchitectureGraph,
  linterReport: {
    timestamp: new Date().toISOString(),
    isCompliant: true,
    violations: [],
    scannedFilesCount: 0,
  } as LinterReport,
  userIntent: "Add an Order aggregate",
  lineage: [],
});

describe("createPromptTemplate", () => {
  it("should create a template with unique id", () => {
    const ctx = makeContext();
    const t1 = createPromptTemplate("test", "sys", "user {{x}}", ctx);
    const t2 = createPromptTemplate("test", "sys", "user {{x}}", ctx);

    assert.notStrictEqual(t1.id, t2.id);
  });

  it("should create a template with version 1", () => {
    const ctx = makeContext();
    const template = createPromptTemplate("test", "sys", "user {{x}}", ctx);

    assert.strictEqual(template.version, 1);
  });

  it("should include provided variables", () => {
    const ctx = makeContext();
    const template = createPromptTemplate("test", "sys", "user {{x}}", ctx, [
      { name: "x", description: "test var", defaultValue: "val" },
    ]);

    assert.strictEqual(template.variables.length, 1);
    assert.strictEqual(template.variables[0].name, "x");
  });
});

describe("renderPrompt", () => {
  it("should substitute variables in the template", () => {
    const ctx = makeContext();
    const template = createPromptTemplate(
      "test",
      "You are an architect.",
      "Please {{action}} the {{target}}.",
      ctx,
      [
        { name: "action", description: "What to do", defaultValue: "add" },
        {
          name: "target",
          description: "What to act on",
          defaultValue: "entity",
        },
      ],
    );

    const result = renderPrompt(template);

    assert.strictEqual(result.userPrompt, "Please add the entity.");
  });

  it("should override default values with provided overrides", () => {
    const ctx = makeContext();
    const template = createPromptTemplate(
      "test",
      "You are an architect.",
      "Please {{action}} the {{target}}.",
      ctx,
      [
        { name: "action", description: "What to do", defaultValue: "add" },
        {
          name: "target",
          description: "What to act on",
          defaultValue: "entity",
        },
      ],
    );

    const result = renderPrompt(template, { action: "remove" });

    assert.strictEqual(result.userPrompt, "Please remove the entity.");
  });

  it("should return system prompt unchanged", () => {
    const ctx = makeContext();
    const template = createPromptTemplate(
      "test",
      "You are an architect.",
      "user prompt",
      ctx,
    );

    const result = renderPrompt(template);

    assert.strictEqual(result.systemPrompt, "You are an architect.");
  });

  it("should return empty string for variables without defaults or overrides", () => {
    const ctx = makeContext();
    const template = createPromptTemplate(
      "test",
      "sys",
      "Hello {{name}}!",
      ctx,
      [{ name: "name", description: "Name" }],
    );

    const result = renderPrompt(template);

    assert.strictEqual(result.userPrompt, "Hello !");
  });
});
