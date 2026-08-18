import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { ModifyArchitectureUseCase } from "../../src/application/use-cases/modify-architecture.use-case";
import type { ModifyArchitectureDeps } from "../../src/application/use-cases/modify-architecture.use-case";
import type { NLToDomainCommandParserPort } from "@hexagen/ai-pipeline";
import type { PipelineStep } from "@hexagen/ai-pipeline";
import type { DomainCommand, IntentLineage } from "@hexagen/core-domain";
import type {
  PromptCompilerPort,
  PromptTemplate,
  RenderedPrompt,
  ArchitectureGraphLike,
  LinterReportLike,
} from "@hexagen/prompt-compiler";
import { DomainModelId } from "@hexagen/local-llm";
import type {
  LLMResponse,
  SendStructuredRequestPort,
} from "@hexagen/local-llm";
import type { LintFilterPort } from "@hexagen/reconciliation-engine";
import {
  ReconcileUseCase,
  StructuredDiffReconciliationAdapter,
  VerdictComparatorAdapter,
  GovernanceAwareConflictResolverAdapter,
  MonotonicStatePromoterAdapter,
  LinterReportFilterAdapter,
} from "@hexagen/reconciliation-engine";
import type { ProjectSpecLike, Patch } from "@hexagen/reconciliation-engine";
import type {
  Transaction,
  TransactionManagerPort,
} from "@hexagen/transaction-system";

function makeLineage(overrides: Partial<IntentLineage> = {}): IntentLineage {
  return {
    intentId: "intent-test-1",
    timestamp: Date.now(),
    origin: { type: "user", actorId: "test-actor" },
    targetContract: { mvkVersion: "1", rrpVersion: "1", remVersion: "1" },
    validation: { valid: true },
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn-test-1",
    intentId: "intent-test-1",
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
    ...overrides,
  };
}

function makeLLMResponse(content: string): LLMResponse {
  return {
    id: "llm-resp-test-1",
    modelId: DomainModelId.QWEN_CODER_3B,
    content,
    finishReason: "stop",
    timestamp: Date.now(),
  };
}

const defaultLLMOutput = JSON.stringify({
  manifest: { boundedContexts: [] },
  architectureGraph: { nodes: [], edges: [] },
  reasoning: "test reasoning",
});

const unsupportedIntentError = {
  code: "UNSUPPORTED_INTENT" as const,
  message: "Cannot parse",
  originalText: "gibberish",
};

function createFailingNLParser(): NLToDomainCommandParserPort {
  return {
    parse: async () => ({ success: false, error: unsupportedIntentError }),
    parseWithMetadata: async () => ({
      success: false,
      error: unsupportedIntentError,
    }),
  };
}

function createFailingLLMSender(): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({
      success: false,
      error: new Error("LLM unavailable"),
    }),
    streamStructuredRequest: async function* () {},
  };
}

function createThrowingPromptCompiler(): PromptCompilerPort {
  return {
    compile: async () => {
      throw new Error("unexpected crash");
    },
    render: () =>
      ({ systemPrompt: "s", userPrompt: "u", variables: {} }) as RenderedPrompt,
  };
}

function createMockDeps(
  overrides: Partial<ModifyArchitectureDeps> & {
    lintFilterPort?: LintFilterPort;
  } = {},
): ModifyArchitectureDeps {
  const parsedCommands = [
    { kind: "add_context", name: "billing" },
  ] as unknown as DomainCommand[];

  const nlParser: NLToDomainCommandParserPort = {
    parse: async () => ({ success: true, value: parsedCommands }),
    parseWithMetadata: async () => ({
      success: true,
      value: {
        commands: parsedCommands,
        metadata: {
          intentType: "create_bounded_context",
          parameters: { name: "billing" },
          confidence: 1,
        },
      },
    }),
  };

  const promptCompiler: PromptCompilerPort = {
    compile: async () =>
      ({
        id: "prompt-test",
        name: "architecture-modification",
        systemPrompt: "system",
        userPromptTemplate: "{{intent}}",
        variables: [{ name: "intent", description: "User intent" }],
        context: {
          manifest: {},
          architectureGraph: {},
          linterReport: {},
          userIntent: "",
          lineage: [],
        },
        version: 1,
      }) as unknown as PromptTemplate,
    render: () => ({
      systemPrompt: "system",
      userPrompt: "user intent",
      variables: { intent: "user intent" },
    }),
  };

  const llmSender: SendStructuredRequestPort = {
    sendRequest: async () => ({
      success: true,
      value: makeLLMResponse(defaultLLMOutput),
    }),
    streamStructuredRequest: async function* () {},
  };

  const reconcileUseCase = new ReconcileUseCase(
    new StructuredDiffReconciliationAdapter(),
    new VerdictComparatorAdapter(),
    new GovernanceAwareConflictResolverAdapter(),
    new MonotonicStatePromoterAdapter(),
    undefined,
    overrides.lintFilterPort ?? new LinterReportFilterAdapter(),
  );

  const transactionManager: TransactionManagerPort = {
    begin: () => makeTransaction(),
    transition: () => makeTransaction({ status: "speculative" }),
    get: () => makeTransaction(),
    list: () => [],
    commit: () => makeTransaction({ status: "committed" }),
    rollback: () => makeTransaction({ status: "rolled_back" }),
    fail: () => makeTransaction({ status: "failed" }),
    compareAndSetStatus: () => makeTransaction({ status: "speculative" }),
  };

  return {
    nlParser,
    promptCompiler,
    llmSender,
    reconcileUseCase,
    transactionManager,
    manifestProvider: async () => ({ boundedContexts: [] }) as ProjectSpecLike,
    architectureGraphProvider: async () =>
      ({ nodes: [], edges: [] }) as ArchitectureGraphLike,
    linterReportProvider: async () =>
      ({
        timestamp: new Date().toISOString(),
        isCompliant: true,
        violations: [],
        scannedFilesCount: 0,
      }) as LinterReportLike,
    ...overrides,
  };
}

describe("modify-architecture", () => {
  it("should complete full pipeline successfully", async () => {
    const deps = createMockDeps();
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a bounded context named billing",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(result.success, "Full pipeline should succeed");
    if (result.success) {
      assert.strictEqual(
        result.value.patchesApplied,
        0,
        "Should report 0 patches applied (speculative)",
      );
      assert.strictEqual(
        result.value.lintPassed,
        null,
        "Lint should be null (not validated yet)",
      );
      assert.strictEqual(
        result.value.transactionId,
        "txn-test-1",
        "Should return transaction ID",
      );
      assert.strictEqual(result.value.steps.length, 5, "Should have 5 steps");
    }
  });

  it("should reject patch targeting lint-errored file", async () => {
    const reportWithViolations: LinterReportLike = {
      timestamp: new Date().toISOString(),
      isCompliant: false,
      violations: [
        {
          ruleId: "no-shared-kernel",
          severity: "error",
          file: "billing",
          message: "Cannot add shared-kernel bounded context",
        },
      ],
      scannedFilesCount: 1,
    };

    // `LintFilterPort` is a per-patch predicate — `shouldAccept(patch, report)`.
    // The old `filterPatches` member matched no port at all, so this double was
    // never actually consulted by ReconcileUseCase.
    const lintFilterPort: LintFilterPort = {
      shouldAccept: (patch) =>
        !reportWithViolations.violations.some(
          (v) => v.file === patch.targetId && v.severity === "error",
        ),
    };

    const deps = createMockDeps({ lintFilterPort });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a bounded context named billing",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(result.success, "Pipeline should complete");
    if (result.success) {
      const billingPatchExists = result.value.patches.some(
        (p: Patch) => p.targetId === "billing",
      );
      assert.strictEqual(
        billingPatchExists,
        false,
        "Patch targeting lint-errored file should be rejected",
      );
    }
  });

  it("should call all ports", async () => {
    let nlParsed = false;
    let compiled = false;
    let rendered = false;
    let llmCalled = false;
    let reconciled = false;
    let transactionBegun = false;

    const mockReconcileUseCase = new ReconcileUseCase(
      {
        reconcile: async () => {
          reconciled = true;
          return {
            success: true,
            patches: [] as Patch[],
            errors: [],
            summary: "",
          };
        },
      } as any,
      { compareVerdicts: () => 0 } as any,
      { resolveConflicts: () => [] } as any,
      { promoteToPhase: (s: unknown) => s } as any,
      undefined,
      { shouldAccept: () => true } as any,
    );

    const deps = createMockDeps({
      nlParser: {
        parse: async () => {
          nlParsed = true;
          return { success: true, value: [] as DomainCommand[] };
        },
        parseWithMetadata: async () => {
          nlParsed = true;
          return {
            success: true,
            value: {
              commands: [] as DomainCommand[],
              metadata: {
                intentType: "create_bounded_context",
                parameters: {},
                confidence: 1,
              },
            },
          };
        },
      },
      promptCompiler: {
        compile: async () => {
          compiled = true;
          return {} as unknown as PromptTemplate;
        },
        render: () => {
          rendered = true;
          return {
            systemPrompt: "s",
            userPrompt: "u",
            variables: {},
          } as RenderedPrompt;
        },
      },
      llmSender: {
        sendRequest: async () => {
          llmCalled = true;
          return {
            success: true as const,
            value: makeLLMResponse(defaultLLMOutput),
          };
        },
        streamStructuredRequest: async function* () {},
      },
      reconcileUseCase: mockReconcileUseCase,
      transactionManager: {
        begin: () => {
          transactionBegun = true;
          return makeTransaction();
        },
        transition: () => makeTransaction({ status: "speculative" }),
        get: () => makeTransaction(),
        list: () => [],
        commit: () => makeTransaction({ status: "committed" }),
        rollback: () => makeTransaction({ status: "rolled_back" }),
        fail: () => makeTransaction({ status: "failed" }),
        compareAndSetStatus: () => makeTransaction({ status: "speculative" }),
      },
    });
    const useCase = new ModifyArchitectureUseCase(deps);
    await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(nlParsed, "NL parser should be called");
    assert.ok(compiled, "Prompt compiler should be called");
    assert.ok(rendered, "Prompt renderer should be called");
    assert.ok(llmCalled, "LLM sender should be called");
    assert.ok(reconciled, "Reconciliation should be called");
    assert.ok(transactionBegun, "Transaction begin should be called");
  });

  it("should complete all steps on success", async () => {
    const deps = createMockDeps();
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(result.success);
    if (result.success) {
      const statuses = result.value.steps.map((s: PipelineStep) => s.status);
      assert.deepStrictEqual(statuses, [
        "completed",
        "completed",
        "completed",
        "completed",
        "completed",
      ]);
    }
  });

  it("should fail on NL parse error", async () => {
    const deps = createMockDeps({ nlParser: createFailingNLParser() });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "gibberish",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(!result.success, "Should fail on NL parse error");
    if (!result.success) {
      assert.ok(
        result.error.message.includes("NL parsing failed"),
        "Error should mention NL parsing",
      );
    }
  });

  it("should fail on LLM error", async () => {
    const deps = createMockDeps({ llmSender: createFailingLLMSender() });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(!result.success, "Should fail on LLM error");
    if (!result.success) {
      assert.ok(
        result.error.message.includes("LLM inference failed"),
        "Error should mention LLM inference",
      );
    }
  });

  it("should fail on reconciliation error", async () => {
    const failingReconciliationPort = {
      reconcile: async () => ({
        success: false,
        patches: [] as Patch[],
        errors: ["Incompatible topology"],
        summary: "Reconciliation failed",
      }),
    };
    const failingReconcileUseCase = new ReconcileUseCase(
      failingReconciliationPort as any,
      { compareVerdicts: () => 0 } as any,
      { resolveConflicts: () => [] } as any,
      { promoteToPhase: (s: unknown) => s } as any,
      undefined,
      { shouldAccept: () => true } as any,
    );

    const deps = createMockDeps({
      reconcileUseCase: failingReconcileUseCase,
    });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(!result.success, "Should fail on reconciliation error");
    if (!result.success) {
      assert.ok(
        result.error.message.includes("Reconciliation failed"),
        "Error should mention reconciliation",
      );
    }
  });

  it("should return correct step names and metadata", async () => {
    const deps = createMockDeps();
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(result.success);
    if (result.success) {
      const names = result.value.steps.map((s: PipelineStep) => s.name);
      assert.deepStrictEqual(names, [
        "parse-nl-intent",
        "compile-prompt",
        "llm-inference",
        "reconcile",
        "commit-patches",
      ]);

      const parseStep = result.value.steps.find(
        (s: PipelineStep) => s.name === "parse-nl-intent",
      )!;
      assert.deepStrictEqual(parseStep.metadata, { intent: "Add a context" });

      const commitStep = result.value.steps.find(
        (s: PipelineStep) => s.name === "commit-patches",
      )!;
      assert.deepStrictEqual(commitStep.metadata, {
        manifestPath: ".architecture/manifest.yaml",
      });
    }
  });

  it("should have endTime on completed steps", async () => {
    const deps = createMockDeps();
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(result.success);
    if (result.success) {
      for (const step of result.value.steps) {
        assert.strictEqual(
          step.status,
          "completed",
          `Step ${step.name} should be completed`,
        );
        assert.ok(
          step.endTime !== undefined,
          `Step ${step.name} should have endTime`,
        );
      }
    }
  });

  it("should fail on unexpected throw in pipeline", async () => {
    const deps = createMockDeps({
      promptCompiler: createThrowingPromptCompiler(),
    });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(!result.success, "Should fail on unexpected throw");
    if (!result.success) {
      assert.strictEqual(result.error.message, "unexpected crash");
    }
  });

  it("should fail when reconciler throws", async () => {
    const throwingReconciliationPort = {
      reconcile: async () => {
        throw new Error("reconciler crashed");
      },
    };
    const throwingReconcileUseCase = new ReconcileUseCase(
      throwingReconciliationPort as any,
      { compareVerdicts: () => 0 } as any,
      { resolveConflicts: () => [] } as any,
      { promoteToPhase: (s: unknown) => s } as any,
      undefined,
      { shouldAccept: () => true } as any,
    );

    const deps = createMockDeps({
      reconcileUseCase: throwingReconcileUseCase,
    });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(!result.success, "Should fail when reconciler throws");
    if (!result.success) {
      assert.strictEqual(result.error.message, "reconciler crashed");
    }
  });
});
