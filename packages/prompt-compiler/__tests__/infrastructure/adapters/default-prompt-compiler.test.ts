import { DefaultPromptCompilerAdapter } from "../../../src/infrastructure/adapters/default-prompt-compiler.adapter.js";
import type { DomainASTLike } from "../../../src/domain/prompt-template.js";

const makeAST = (): DomainASTLike => ({
  nodes: [],
  edges: [],
  invariants: { topology: [], cardinality: [] },
});

describe("DefaultPromptCompilerAdapter", () => {
  let adapter: DefaultPromptCompilerAdapter;

  beforeEach(() => {
    adapter = new DefaultPromptCompilerAdapter();
  });

  describe("compile()", () => {
    it("should create a prompt template from a request", async () => {
      const template = await adapter.compile({
        name: "add-entity",
        domainAST: makeAST(),
        userIntent: "Add an Order entity",
        governanceRules: ["Entities must have an ID"],
      });

      expect(template.name).toBe("add-entity");
      expect(template.systemPrompt).toBeDefined();
      expect(template.systemPrompt.length).toBeGreaterThan(0);
      expect(template.userPromptTemplate).toBeDefined();
      expect(template.variables.length).toBeGreaterThan(0);
    });

    it("should include domain AST as a variable", async () => {
      const template = await adapter.compile({
        name: "test",
        domainAST: makeAST(),
        userIntent: "Test",
        governanceRules: [],
      });

      const domainASTVar = template.variables.find((v) => v.name === "domainAST");
      expect(domainASTVar).toBeDefined();
    });

    it("should include governance rules as a variable", async () => {
      const template = await adapter.compile({
        name: "test",
        domainAST: makeAST(),
        userIntent: "Test",
        governanceRules: ["Rule 1", "Rule 2"],
      });

      const rulesVar = template.variables.find((v) => v.name === "governanceRules");
      expect(rulesVar).toBeDefined();
    });
  });

  describe("render()", () => {
    it("should render a template with variable substitution", async () => {
      const template = await adapter.compile({
        name: "test",
        domainAST: makeAST(),
        userIntent: "Add entity",
        governanceRules: [],
      });

      const rendered = adapter.render(template);

      expect(rendered.systemPrompt).toBeDefined();
      expect(rendered.userPrompt).toBeDefined();
      expect(rendered.variables).toBeDefined();
    });
  });
});