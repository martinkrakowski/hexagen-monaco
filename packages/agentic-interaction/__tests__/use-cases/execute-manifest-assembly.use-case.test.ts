import test from "node:test";
import assert from "node:assert/strict";
import { ExecuteManifestAssemblyUseCase } from "../../src/application/use-cases/staged-generation/execute-manifest-assembly.use-case.js";
import type { PipelineState } from "../../src/domain/value-objects/pipeline-state.js";

test("ExecuteManifestAssemblyUseCase maps pipeline state to manifest yaml", () => {
  const useCase = new ExecuteManifestAssemblyUseCase();

  const state: Pick<PipelineState, "stage0" | "stage2" | "stage3" | "stage4"> =
    {
      stage0: {
        intent: "build an e-commerce platform",
        explicitTechnologies: ["Postgres"],
        explicitPatterns: [],
        ambiguities: [],
      },
      stage2: {
        accepted: [
          { name: "order-management", type: "core", reasoning: "Core domain" },
          {
            name: "payment-processing",
            type: "generic",
            reasoning: "Generic domain",
          },
        ],
        rejected: [],
        uncertain: [],
      },
      stage3: {
        contexts: [
          {
            contextName: "order-management",
            in: [
              {
                name: "CreateOrderPort",
                type: "command",
                description: "Creates orders",
              },
            ],
            out: [
              {
                name: "OrderRepositoryPort",
                type: "repository",
                description: "Saves orders",
              },
            ],
          },
        ],
      },
      stage4: {
        contexts: [
          {
            contextName: "order-management",
            adapters: [
              {
                name: "PostgresOrderAdapter",
                type: "Repository",
                implements: "OrderRepositoryPort",
              },
            ],
          },
        ],
      },
    };

  const result = useCase.execute(state);

  assert.strictEqual(typeof result.yaml, "string");
  assert.match(result.yaml, /name: order-management/);
  assert.match(result.yaml, /name: payment-processing/);
  assert.match(result.yaml, /CreateOrderPort/);
  assert.ok(result.parsedObject, "parsedObject should be defined");
});
