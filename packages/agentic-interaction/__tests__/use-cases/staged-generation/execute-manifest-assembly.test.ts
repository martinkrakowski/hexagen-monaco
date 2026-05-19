import { test, describe } from "node:test";
import assert from "node:assert";
import { ExecuteManifestAssemblyUseCase } from "../../../src/application/use-cases/staged-generation/execute-manifest-assembly.use-case.js";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state.js";

describe("Stage 5: Manifest Assembly", () => {
  const useCase = new ExecuteManifestAssemblyUseCase();

  test("assembles manifest from valid state", () => {
    const state: Pick<
      PipelineState,
      "stage0" | "stage2" | "stage3" | "stage4"
    > = {
      stage0: {
        intent: "Invoice system",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        projectName: "invoice-app",
      },
      stage2: {
        accepted: [
          {
            name: "invoice-management",
            type: "core",
            reasoning: "Manages invoices",
          },
        ],
        rejected: [],
        uncertain: [],
      },
      stage3: {
        contexts: [
          {
            contextName: "invoice-management",
            in: [],
            out: [
              { name: "repo", type: "repository", description: "Invoice repo" },
            ],
          },
        ],
      },
      stage4: {
        contexts: [
          {
            contextName: "invoice-management",
            adapters: [
              {
                name: "InMemoryAdapter",
                type: "Repository",
                implements: "repo",
              },
            ],
          },
        ],
      },
    };

    const result = useCase.execute(state);
    assert.ok(result.yaml);
    assert.ok(result.parsedObject);
    assert.ok(Array.isArray(result.assemblyWarnings));
  });

  test("returns warnings for contexts with no ports", () => {
    const state: Pick<
      PipelineState,
      "stage0" | "stage2" | "stage3" | "stage4"
    > = {
      stage0: {
        intent: "Test",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        projectName: "test-app",
      },
      stage2: {
        accepted: [
          { name: "test-context", type: "core", reasoning: "Test context" },
        ],
        rejected: [],
        uncertain: [],
      },
      stage3: { contexts: [] },
      stage4: { contexts: [] },
    };

    const result = useCase.execute(state);
    assert.ok((result.assemblyWarnings ?? []).length > 0);
    assert.ok(
      (result.assemblyWarnings ?? []).some(
        (w) =>
          w.contextName === "test-context" &&
          w.message.includes("no ports defined"),
      ),
    );
  });

  test("returns warnings for outbound ports with no adapters", () => {
    const state: Pick<
      PipelineState,
      "stage0" | "stage2" | "stage3" | "stage4"
    > = {
      stage0: {
        intent: "Test",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        projectName: "test-app",
      },
      stage2: {
        accepted: [
          { name: "test-context", type: "core", reasoning: "Test context" },
        ],
        rejected: [],
        uncertain: [],
      },
      stage3: {
        contexts: [
          {
            contextName: "test-context",
            in: [],
            out: [
              { name: "repo", type: "repository", description: "Test repo" },
            ],
          },
        ],
      },
      stage4: { contexts: [{ contextName: "test-context", adapters: [] }] },
    };

    const result = useCase.execute(state);
    assert.ok((result.assemblyWarnings ?? []).length > 0);
    assert.ok(
      (result.assemblyWarnings ?? []).some((w) =>
        w.message.includes("no assigned adapter"),
      ),
    );
  });

  test("handles missing project name gracefully", () => {
    const state = {
      stage0: {
        intent: "Test system",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
      },
      stage2: { accepted: [], rejected: [], uncertain: [] },
      stage3: { contexts: [] },
      stage4: { contexts: [] },
      contextMappings: [],
    };

    const result = useCase.execute(state);
    assert.ok(result.yaml);
    assert.ok(result.parsedObject);
    assert.ok(Array.isArray(result.assemblyWarnings));
    assert.ok(
      result.yaml.includes("test") || result.yaml.includes("hexagen-workspace"),
      "Expected default project name in YAML",
    );
  });

  test("handles empty accepted contexts", () => {
    const state = {
      stage0: {
        intent: "Test",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        projectName: "test-app",
      },
      stage2: { accepted: [], rejected: [], uncertain: [] },
      stage3: { contexts: [] },
      stage4: { contexts: [] },
    };

    const result = useCase.execute(state);
    assert.ok(result.yaml);
    assert.ok(result.parsedObject);
    // YAML should be valid even with no contexts
    assert.ok(result.yaml.length > 0);
  });

  test("generates warnings for incomplete state", () => {
    const state = {
      stage0: {
        intent: "Test",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        projectName: "test-app",
      },
      stage2: {
        accepted: [
          { name: "test-context", type: "core" as const, reasoning: "Test" },
        ],
        rejected: [],
        uncertain: [],
      },
      stage3: { contexts: [] }, // no ports defined
      stage4: { contexts: [] }, // no adapters
    };

    const result = useCase.execute(state);
    assert.ok(Array.isArray(result.assemblyWarnings));
    assert.ok((result.assemblyWarnings ?? []).length > 0);
    assert.ok(
      (result.assemblyWarnings ?? []).some(
        (w) => w.contextName === "test-context",
      ),
    );
  });

  test("handles special characters in context names", () => {
    const state = {
      stage0: {
        intent: "Test",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        projectName: "test-app",
      },
      stage2: {
        accepted: [
          {
            name: "test-context-123",
            type: "core" as const,
            reasoning: "Test",
          },
        ],
        rejected: [],
        uncertain: [],
      },
      stage3: {
        contexts: [{ contextName: "test-context-123", in: [], out: [] }],
      },
      stage4: { contexts: [{ contextName: "test-context-123", adapters: [] }] },
    };

    const result = useCase.execute(state);
    assert.ok(result.yaml);
    // YAML should contain the context name with special chars
    assert.ok(result.yaml.includes("test-context-123"));
    assert.ok(result.parsedObject);
  });

  test("always returns assemblyWarnings as array", () => {
    const state = {
      stage0: {
        intent: "Test",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        projectName: "test-app",
      },
      stage2: { accepted: [], rejected: [], uncertain: [] },
      stage3: { contexts: [] },
      stage4: { contexts: [] },
    };

    const result = useCase.execute(state);
    assert.ok(Array.isArray(result.assemblyWarnings));
  });
});
