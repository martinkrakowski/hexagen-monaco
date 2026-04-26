import assert from "node:assert/strict";
import { ModifyArchitectureUseCase } from "../../src/application/use-cases/modify-architecture.use-case.js";
import type { ModifyArchitectureDeps } from "../../src/application/use-cases/modify-architecture.use-case.js";
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
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import type {
  ReconciliationPort,
  ProjectSpecLike,
  Patch,
} from "@hexagen/reconciliation-engine";
import type {
  Transaction,
  TransactionManagerPort,
  ManifestMutationPort,
  LintValidationPort,
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

const defaultLLMOutput = JSON.stringify({
  manifest: { boundedContexts: [] },
  architectureGraph: { nodes: [], edges: [] },
  reasoning: "test reasoning",
});

function createFailingNLParser(): NLToDomainCommandParserPort {
  return {
    parse: async () => ({
      success: false,
      error: {
        code: "UNSUPPORTED_INTENT" as const,
        message: "Cannot parse",
        originalText: "gibberish",
      },
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

function createFailingReconciliation(): ReconciliationPort {
  return {
    reconcile: async () => ({
      success: false,
      patches: [] as Patch[],
      errors: ["Incompatible topology"],
      summary: "Reconciliation failed",
    }),
  };
}

function createFailingLintValidation(): LintValidationPort {
  return {
    validateManifest: async () => ({
      success: true,
      value: { valid: false, errors: ["port in >1 context"] },
    }),
  };
}

function createErrorLintValidation(): LintValidationPort {
  return {
    validateManifest: async () => ({
      success: false,
      error: new Error("linter crashed"),
    }),
  };
}

function createNullCommitTransactionManager(): TransactionManagerPort {
  const tx = makeTransaction();
  return {
    begin: () => tx,
    transition: () => makeTransaction({ status: "speculative" }),
    get: () => tx,
    list: () => [],
    commit: () => null,
    rollback: () => makeTransaction({ status: "rolled_back" }),
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

function createThrowingReconciliation(): ReconciliationPort {
  return {
    reconcile: async () => {
      throw new Error("reconciler crashed");
    },
  };
}

function createMockDeps(
  overrides: Partial<ModifyArchitectureDeps> = {},
): ModifyArchitectureDeps {
  const nlParser: NLToDomainCommandParserPort = {
    parse: async () => ({
      success: true,
      value: [
        { kind: "add_context", name: "billing" },
      ] as unknown as DomainCommand[],
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
      value: { content: defaultLLMOutput },
    }),
    streamStructuredRequest: async function* () {},
  };

  const reconciliationPort: ReconciliationPort = {
    reconcile: async () => ({
      success: true,
      patches: [] as Patch[],
      errors: [],
      summary: "no differences",
    }),
  };

  const transactionManager: TransactionManagerPort = {
    begin: () => makeTransaction(),
    transition: () => makeTransaction({ status: "speculative" }),
    get: () => makeTransaction(),
    list: () => [],
    commit: () => makeTransaction({ status: "committed" }),
    rollback: () => makeTransaction({ status: "rolled_back" }),
  };

  const manifestMutation: ManifestMutationPort = {
    applyPatches: async () => ({ success: true, value: undefined }),
    restoreFromGit: async () => ({ success: true, value: undefined }),
  };

  const lintValidation: LintValidationPort = {
    validateManifest: async () => ({
      success: true,
      value: { valid: true, errors: [] as string[] },
    }),
  };

  return {
    nlParser,
    promptCompiler,
    llmSender,
    reconciliationPort,
    transactionManager,
    manifestMutation,
    lintValidation,
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

(async () => {
  // --- Full pipeline success ---
  {
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
        "Should report 0 patches",
      );
      assert.strictEqual(result.value.lintPassed, true, "Lint should pass");
      assert.strictEqual(
        result.value.transactionId,
        "txn-test-1",
        "Should return transaction ID",
      );
      assert.strictEqual(result.value.steps.length, 5, "Should have 5 steps");
    }
    console.log("✅ Test 1: full pipeline success - passed");
  }

  // --- All ports called ---
  {
    let nlParsed = false;
    let compiled = false;
    let rendered = false;
    let llmCalled = false;
    let reconciled = false;
    let committed = false;

    const deps = createMockDeps({
      nlParser: {
        parse: async () => {
          nlParsed = true;
          return { success: true, value: [] as DomainCommand[] };
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
          return { success: true, value: { content: defaultLLMOutput } };
        },
        streamStructuredRequest: async function* () {},
      },
      reconciliationPort: {
        reconcile: async () => {
          reconciled = true;
          return {
            success: true,
            patches: [] as Patch[],
            errors: [],
            summary: "",
          };
        },
      },
      transactionManager: {
        begin: () => makeTransaction(),
        transition: () => makeTransaction({ status: "speculative" }),
        get: () => makeTransaction(),
        list: () => [],
        commit: () => {
          committed = true;
          return makeTransaction({ status: "committed" });
        },
        rollback: () => makeTransaction({ status: "rolled_back" }),
      },
    } as unknown as ModifyArchitectureDeps);
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
    assert.ok(committed, "Transaction commit should be called");
    console.log("✅ Test 2: all ports called - passed");
  }

  // --- All steps completed on success ---
  {
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
    console.log("✅ Test 3: all steps completed on success - passed");
  }

  // --- NL parse failure ---
  {
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
    console.log("✅ Test 4: NL parse failure - passed");
  }

  // --- LLM inference failure ---
  {
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
    console.log("✅ Test 5: LLM inference failure - passed");
  }

  // --- Reconciliation failure ---
  {
    const deps = createMockDeps({
      reconciliationPort: createFailingReconciliation(),
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
    console.log("✅ Test 6: reconciliation failure - passed");
  }

  // --- Lint validation failure (rollback) ---
  {
    let restoreFromGitCalled = false;
    let rollbackCalled = false;
    const deps = createMockDeps({
      lintValidation: createFailingLintValidation(),
      manifestMutation: {
        applyPatches: async () => ({ success: true, value: undefined }),
        restoreFromGit: async () => {
          restoreFromGitCalled = true;
          return { success: true, value: undefined };
        },
      },
      transactionManager: {
        begin: () => makeTransaction(),
        transition: () => makeTransaction({ status: "speculative" }),
        get: () => makeTransaction(),
        list: () => [],
        commit: () => makeTransaction({ status: "committed" }),
        rollback: () => {
          rollbackCalled = true;
          return makeTransaction({ status: "rolled_back" });
        },
      },
    });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(!result.success, "Should fail on lint validation error");
    if (!result.success) {
      assert.ok(
        result.error.message.includes("Lint validation failed"),
        "Error should mention lint",
      );
    }
    assert.ok(restoreFromGitCalled, "Should restore from git on lint failure");
    assert.ok(rollbackCalled, "Should rollback transaction on lint failure");
    console.log("✅ Test 7: lint validation failure with rollback - passed");
  }

  // --- Lint validation error (linter crashes) ---
  {
    let restoreFromGitCalled = false;
    const deps = createMockDeps({
      lintValidation: createErrorLintValidation(),
      manifestMutation: {
        applyPatches: async () => ({ success: true, value: undefined }),
        restoreFromGit: async () => {
          restoreFromGitCalled = true;
          return { success: true, value: undefined };
        },
      },
    });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(!result.success, "Should fail on lint error");
    if (!result.success) {
      assert.ok(
        result.error.message.includes("linter crashed"),
        "Error should mention linter crash",
      );
    }
    assert.ok(
      restoreFromGitCalled,
      "Should restore from git when linter crashes",
    );
    console.log("✅ Test 8: lint validation error (linter crashes) - passed");
  }

  // --- Patch application failure ---
  {
    let restoreFromGitCalled = false;
    let rollbackCalled = false;
    const deps = createMockDeps({
      manifestMutation: {
        applyPatches: async () => ({
          success: false,
          error: new Error("disk full"),
        }),
        restoreFromGit: async () => {
          restoreFromGitCalled = true;
          return { success: true, value: undefined };
        },
      },
      transactionManager: {
        begin: () => makeTransaction(),
        transition: () => makeTransaction({ status: "speculative" }),
        get: () => makeTransaction(),
        list: () => [],
        commit: () => makeTransaction({ status: "committed" }),
        rollback: () => {
          rollbackCalled = true;
          return makeTransaction({ status: "rolled_back" });
        },
      },
    });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(!result.success, "Should fail on patch application error");
    if (!result.success) {
      assert.ok(
        result.error.message.includes("disk full"),
        "Error should mention disk full",
      );
    }
    assert.ok(restoreFromGitCalled, "Should restore from git on patch failure");
    assert.ok(rollbackCalled, "Should rollback on patch failure");
    console.log("✅ Test 9: patch application failure - passed");
  }

  // --- Commit returns null ---
  {
    const deps = createMockDeps({
      transactionManager: createNullCommitTransactionManager(),
    });
    const useCase = new ModifyArchitectureUseCase(deps);
    const result = await useCase.execute(
      "Add a context",
      ".architecture/manifest.yaml",
      makeLineage(),
    );

    assert.ok(!result.success, "Should fail when commit returns null");
    if (!result.success) {
      assert.ok(
        result.error.message.includes("Failed to commit transaction"),
        "Error should mention commit failure",
      );
    }
    console.log("✅ Test 10: commit returns null - passed");
  }

  // --- Step names and metadata ---
  {
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
    console.log("✅ Test 11: step names and metadata - passed");
  }

  // --- Steps have endTime when completed ---
  {
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
    console.log("✅ Test 12: steps have endTime when completed - passed");
  }

  // --- Unexpected throw in pipeline ---
  {
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
    console.log("✅ Test 13: unexpected throw in pipeline - passed");
  }

  // --- Reconciler throws ---
  {
    const deps = createMockDeps({
      reconciliationPort: createThrowingReconciliation(),
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
    console.log("✅ Test 14: reconciler throws - passed");
  }

  console.log("✅ All ModifyArchitectureUseCase tests passed.");
})();
