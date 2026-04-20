import {
  createPromptTemplate,
  renderPrompt,
} from "../src/domain/prompt-template.js";
import type { DomainASTLike, PromptContext } from "../src/domain/prompt-template.js";

const makeContext = (): PromptContext => ({
  domainAST: {
    nodes: [],
    edges: [],
    invariants: { topology: [], cardinality: [] },
  },
  userIntent: "Add an Order aggregate",
  governanceRules: ["Aggregate must have at least one entity"],
  lineage: [],
});

describe("createPromptTemplate", () => {
  it("should create a template with unique id", () => {
    const ctx = makeContext();
    const t1 = createPromptTemplate("test", "sys", "user {{x}}", ctx);
    const t2 = createPromptTemplate("test", "sys", "user {{x}}", ctx);

    expect(t1.id).not.toBe(t2.id);
  });

  it("should create a template with version 1", () => {
    const ctx = makeContext();
    const template = createPromptTemplate("test", "sys", "user {{x}}", ctx);

    expect(template.version).toBe(1);
  });

  it("should include provided variables", () => {
    const ctx = makeContext();
    const template = createPromptTemplate(
      "test",
      "sys",
      "user {{x}}",
      ctx,
      [{ name: "x", description: "test var", defaultValue: "val" }],
    );

    expect(template.variables).toHaveLength(1);
    expect(template.variables[0].name).toBe("x");
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
        { name: "target", description: "What to act on", defaultValue: "entity" },
      ],
    );

    const result = renderPrompt(template);

    expect(result.userPrompt).toBe("Please add the entity.");
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
        { name: "target", description: "What to act on", defaultValue: "entity" },
      ],
    );

    const result = renderPrompt(template, { action: "remove" });

    expect(result.userPrompt).toBe("Please remove the entity.");
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

    expect(result.systemPrompt).toBe("You are an architect.");
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

    expect(result.userPrompt).toBe("Hello !");
  });
});