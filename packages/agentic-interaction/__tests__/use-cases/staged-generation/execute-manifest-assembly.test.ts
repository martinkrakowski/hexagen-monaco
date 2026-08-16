import { test, describe } from "vitest";
import assert from "node:assert";
import { ExecuteManifestAssemblyUseCase } from "../../../src/application/use-cases/staged-generation/execute-manifest-assembly.use-case";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state";

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

  // Regression (alvaro-ai import): LLM-derived `apps` entries flowed verbatim
  // into the rendered YAML; a single entry without a `name` failed the accept
  // screen's strict ManifestSchema parse and bricked the whole run behind a
  // generic "could not be parsed". The Stage-5 schema gate must sanitize the
  // output and report what it changed.
  test("schema gate sanitizes LLM-derived apps and reports advisories", () => {
    const state = {
      stage0: {
        intent: "Batch image upscaler",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        projectName: "alvaro-ai",
      },
      stage2: {
        accepted: [
          { name: "image-domain", type: "core" as const, reasoning: "Images" },
        ],
        rejected: [],
        uncertain: [],
      },
      stage3: {
        contexts: [
          {
            contextName: "image-domain",
            in: [],
            out: [
              {
                name: "ImageRepositoryPort",
                type: "repository" as const,
                description: "Image persistence",
              },
            ],
          },
        ],
      },
      stage4: { contexts: [{ contextName: "image-domain", adapters: [] }] },
      // The shapes a loose-spec conversion has actually emitted: a bare string
      // and an object missing `name`.
      apps: ["web", { framework: "next.js" }, { name: "api" }],
    };

    const result = useCase.execute(state);

    assert.ok(result.schemaAdvisories);
    assert.equal(result.schemaAdvisories.length, 2);
    assert.equal(result.schemaIssues, undefined);
    // The rendered YAML and parsedObject agree, and both carry the sanitized apps.
    const apps = (result.parsedObject as { apps: unknown[] }).apps;
    assert.deepEqual(apps, [{ name: "web" }, { name: "api" }]);
    assert.ok(result.yaml.includes("name: api"));
    assert.ok(!result.yaml.includes("next.js"));
  });

  test("renders adapters from ALL duplicate bindings entries (warning and YAML agree)", () => {
    // Bindings can hold a context twice (pre-defined entry + a stage echo). A
    // first-match draft build silently dropped later entries' adapters from
    // the YAML while the aggregated uncovered-port warning saw them — the
    // warning went quiet about an adapter the manifest didn't contain.
    const state: Pick<
      PipelineState,
      "stage0" | "stage2" | "stage3" | "stage4"
    > = {
      stage0: {
        intent: "Upscaler",
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
        projectName: "alvaro",
      },
      stage2: {
        accepted: [
          { name: "real-esrgan", type: "core", reasoning: "Upscaling engine" },
        ],
        rejected: [],
        uncertain: [],
      },
      stage3: {
        contexts: [
          {
            contextName: "real-esrgan",
            in: [],
            out: [
              {
                name: "UpscalePort",
                type: "external-client",
                description: "Perform super-resolution",
              },
              {
                name: "RealEsrganRepositoryPort",
                type: "repository",
                description: "Persistence",
              },
            ],
          },
        ],
      },
      stage4: {
        contexts: [
          {
            contextName: "real-esrgan",
            adapters: [
              {
                name: "RealESRGANAdapter",
                type: "HttpClient",
                implements: "UpscalePort",
              },
            ],
          },
          {
            contextName: "real-esrgan",
            adapters: [
              {
                name: "RealEsrganRepositoryAdapter",
                type: "Repository",
                implements: "RealEsrganRepositoryPort",
              },
              // Exact duplicate of the first entry's adapter — must not render twice.
              {
                name: "RealESRGANAdapter",
                type: "HttpClient",
                implements: "UpscalePort",
              },
            ],
          },
        ],
      },
    };

    const result = useCase.execute(state);
    const adapterLines = result.yaml
      .split("\n")
      .filter((l) => l.includes("Adapter"));
    assert.ok(
      result.yaml.includes("RealEsrganRepositoryAdapter"),
      "second entry's adapter must reach the YAML",
    );
    assert.equal(
      adapterLines.filter((l) => l.includes("RealESRGANAdapter")).length,
      1,
      "duplicate adapter name renders once",
    );
    // Both ports covered → no uncovered-port warning; YAML and warnings agree.
    assert.ok(
      !(result.assemblyWarnings ?? []).some((w) =>
        w.message.includes("no assigned adapter"),
      ),
      JSON.stringify(result.assemblyWarnings),
    );
  });
});
