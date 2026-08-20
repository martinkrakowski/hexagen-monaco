import { describe, it, vi } from "vitest";
import assert from "node:assert";
import {
  GenerateWithAiFlowUseCase,
  type GenerateWithAiFlowCallbacks,
} from "../../../src/application/use-cases/generate-with-ai-flow.use-case";
import type { ClientManifestGenerationUseCase } from "../../../src/application/use-cases/client-manifest-generation.use-case";
import type { ManifestTopologyDraft } from "@hexagen/agentic-interaction";

function createMockUseCase(
  overrides: Partial<{
    generateTopologyResult:
      | { ok: true; topology: ManifestTopologyDraft }
      | { ok: false; error: string };
    extractAdaptersResult:
      | { ok: true; draft: unknown; diagnostics: unknown[] }
      | { ok: false; error: string };
    renderManifestResult: { yaml: string; diagnostics: unknown[] };
    checkClarificationTriggersResult: unknown[];
  }>,
): ClientManifestGenerationUseCase {
  return {
    generateTopology: vi.fn(
      async () =>
        overrides.generateTopologyResult ?? {
          ok: true,
          topology: {
            workspace: { name: "test", description: "test" },
            boundedContexts: [],
          },
        },
    ),
    extractAdapters: vi.fn(
      async () =>
        overrides.extractAdaptersResult ?? {
          ok: true,
          draft: {},
          diagnostics: [],
        },
    ),
    renderManifest: vi.fn(
      async () =>
        overrides.renderManifestResult ?? {
          yaml: "test: yaml",
          diagnostics: [],
        },
    ),
    checkClarificationTriggers: vi.fn(
      () => overrides.checkClarificationTriggersResult ?? [],
    ),
  } satisfies ClientManifestGenerationUseCase;
}

describe("GenerateWithAiFlowUseCase", () => {
  it("returns complete with manifest on successful generation", async () => {
    const mockUseCase = createMockUseCase({});
    const useCase = new GenerateWithAiFlowUseCase(mockUseCase);

    const callbacks: GenerateWithAiFlowCallbacks = {
      onError: () => {},
      onSaveGenerationResult: () => {},
      onClarificationNeeded: () => {},
      onStepDetail: () => {},
    };

    const result = await useCase.execute(
      { description: "test project" },
      new AbortController().signal,
      callbacks,
    );

    assert.strictEqual(result.kind, "complete");
    assert.strictEqual(
      (result as { kind: "complete"; manifest: string }).manifest,
      "test: yaml",
    );
  });

  it("returns clarification_needed when triggers exist", async () => {
    const mockUseCase = createMockUseCase({
      checkClarificationTriggersResult: [
        {
          type: "missing_port",
          contextName: "TestCtx",
          message: "Port missing",
        },
      ],
    });
    const useCase = new GenerateWithAiFlowUseCase(mockUseCase);

    const callbacks: GenerateWithAiFlowCallbacks = {
      onError: () => {},
      onSaveGenerationResult: () => {},
      onClarificationNeeded: () => {},
      onStepDetail: () => {},
    };

    const result = await useCase.execute(
      { description: "test project" },
      new AbortController().signal,
      callbacks,
    );

    assert.strictEqual(result.kind, "clarification_needed");
  });

  it("returns error on topology generation failure", async () => {
    const mockUseCase = createMockUseCase({
      generateTopologyResult: {
        ok: false,
        error:
          "Generated manifest has invalid YAML: mapping values are not allowed here",
      },
    });
    const useCase = new GenerateWithAiFlowUseCase(mockUseCase);

    const callbacks: GenerateWithAiFlowCallbacks = {
      onError: () => {},
      onSaveGenerationResult: () => {},
      onClarificationNeeded: () => {},
      onStepDetail: () => {},
    };

    const result = await useCase.execute(
      { description: "test project" },
      new AbortController().signal,
      callbacks,
    );

    assert.strictEqual(result.kind, "error");
    assert.strictEqual(
      (result as { kind: "error"; code: string }).code,
      "yaml_validation_failed",
    );
  });

  it("calls onStepDetail throughout execution", async () => {
    const mockUseCase = createMockUseCase({});
    const useCase = new GenerateWithAiFlowUseCase(mockUseCase);

    const steps: string[] = [];
    const callbacks: GenerateWithAiFlowCallbacks = {
      onError: () => {},
      onSaveGenerationResult: () => {},
      onClarificationNeeded: () => {},
      onStepDetail: (detail) => steps.push(detail),
    };

    await useCase.execute(
      { description: "test project" },
      new AbortController().signal,
      callbacks,
    );

    assert.ok(steps.length >= 3);
    assert.ok(steps.some((s) => s.includes("Analyzing")));
    assert.ok(steps.some((s) => s.includes("Extracting")));
    assert.ok(steps.some((s) => s.includes("Rendering")));
  });
});
