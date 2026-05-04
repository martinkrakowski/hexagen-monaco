import assert from "node:assert/strict";
import { describe, it, beforeEach, mock } from "node:test";
import type { Transaction } from "../../../src/domain/transaction.js";
import type { TransactionManagerPort } from "../../../src/application/ports/in/transaction-manager.port.js";
import type { ManifestMutationPort } from "../../../src/application/ports/out/manifest-mutation.port.js";
import type { LintValidationPort } from "../../../src/application/ports/out/lint-validation.port.js";
import type { Patch, IntentLineage } from "@hexagen/core-domain";
import { CommitPatchesUseCase } from "../../../src/application/use-cases/commit-patches.use-case.js";

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? ((...args: A) => R) & {
        mock: {
          calls: Array<{ arguments: A }>;
          callCount(): number;
          mockImplementationOnce(
            impl: (...args: A) => R,
            onCall?: number,
          ): void;
          restore(): void;
        };
      }
    : T[K];
};

function makeLineage(overrides: Partial<IntentLineage> = {}): IntentLineage {
  return {
    intentId: "intent-1",
    timestamp: Date.now(),
    origin: { type: "user", actorId: "actor-1" },
    targetContract: { mvkVersion: "1", rrpVersion: "1", remVersion: "1" },
    validation: { valid: true },
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn-test-1",
    intentId: "intent-1",
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe("CommitPatchesUseCase", () => {
  let useCase: CommitPatchesUseCase;
  let transactionManager: Mocked<TransactionManagerPort>;
  let manifestMutation: Mocked<ManifestMutationPort>;
  let lintValidation: Mocked<LintValidationPort>;

  beforeEach(() => {
    transactionManager = {
      begin: mock.fn(() => makeTransaction()),
      transition: mock.fn(() => makeTransaction({ status: "speculative" })),
      get: mock.fn(() => makeTransaction()),
      list: mock.fn(() => []),
      commit: mock.fn(() => makeTransaction({ status: "committed" })),
      rollback: mock.fn(() => makeTransaction({ status: "rolled_back" })),
    } as unknown as Mocked<TransactionManagerPort>;

    manifestMutation = {
      applyPatches: mock.fn(() =>
        Promise.resolve({ success: true, value: undefined }),
      ),
      restoreFromGit: mock.fn(() =>
        Promise.resolve({ success: true, value: undefined }),
      ),
    } as unknown as Mocked<ManifestMutationPort>;

    lintValidation = {
      validateManifest: mock.fn(() =>
        Promise.resolve({
          success: true,
          value: { valid: true, errors: [] },
        }),
      ),
    } as unknown as Mocked<LintValidationPort>;

    useCase = new CommitPatchesUseCase(
      transactionManager,
      manifestMutation,
      lintValidation,
    );
  });

  describe("success path", () => {
    it("should begin, apply patches, validate, and commit", async () => {
      const patches: Patch[] = [
        {
          id: "p1",
          type: "add_node",
          targetId: "my-context",
          payload: { kind: "core" },
        },
      ];
      const lineage = makeLineage();

      const result = await useCase.execute(
        patches,
        lineage,
        "/path/to/manifest.yaml",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.status, "committed");
      }

      assert.strictEqual(
        transactionManager.begin.mock.calls[0].arguments[0],
        "intent-1",
      );
      assert.strictEqual(
        (
          transactionManager.begin.mock.calls[0].arguments[1] as {
            intentId: string;
          }
        ).intentId,
        "intent-1",
      );
      assert.strictEqual(
        transactionManager.transition.mock.calls[0].arguments[0],
        "txn-test-1",
      );
      assert.strictEqual(
        transactionManager.transition.mock.calls[0].arguments[1],
        "speculative",
      );
      assert.deepStrictEqual(
        manifestMutation.applyPatches.mock.calls[0].arguments,
        [patches, "/path/to/manifest.yaml"],
      );
      assert.strictEqual(
        lintValidation.validateManifest.mock.calls[0].arguments[0],
        "/path/to/manifest.yaml",
      );
      assert.strictEqual(
        transactionManager.commit.mock.calls[0].arguments[0],
        "txn-test-1",
      );
    });
  });

  describe("patch application failure", () => {
    it("should rollback and restore from git when applyPatches fails", async () => {
      manifestMutation.applyPatches.mock.mockImplementationOnce(async () => ({
        success: false,
        error: new Error("disk full"),
      }));

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.message.includes("disk full"));
      }

      assert.strictEqual(
        manifestMutation.restoreFromGit.mock.calls[0].arguments[0],
        "/path/to/manifest.yaml",
      );
      assert.strictEqual(
        transactionManager.rollback.mock.calls[0].arguments[0],
        "txn-test-1",
      );
      assert.ok(
        (
          transactionManager.rollback.mock.calls[0].arguments[1] as string
        ).includes("Patch application failed"),
      );
      assert.strictEqual(transactionManager.commit.mock.calls.length, 0);
    });
  });

  describe("lint validation failure", () => {
    it("should rollback and restore from git when lint returns invalid", async () => {
      lintValidation.validateManifest.mock.mockImplementationOnce(async () => ({
        success: true,
        value: {
          valid: false,
          errors: ["port in >1 context", "missing adapter"],
        },
      }));

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.message.includes("port in >1 context"));
      }

      assert.strictEqual(
        manifestMutation.restoreFromGit.mock.calls[0].arguments[0],
        "/path/to/manifest.yaml",
      );
      assert.strictEqual(
        transactionManager.rollback.mock.calls[0].arguments[0],
        "txn-test-1",
      );
      assert.ok(
        (
          transactionManager.rollback.mock.calls[0].arguments[1] as string
        ).includes("Lint validation failed"),
      );
      assert.strictEqual(transactionManager.commit.mock.calls.length, 0);
    });
  });

  describe("lint validation error", () => {
    it("should rollback when lint throws an error", async () => {
      lintValidation.validateManifest.mock.mockImplementationOnce(async () => ({
        success: false,
        error: new Error("linter crashed"),
      }));

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.message.includes("linter crashed"));
      }

      assert.strictEqual(
        manifestMutation.restoreFromGit.mock.calls[0].arguments[0],
        "/path/to/manifest.yaml",
      );
      assert.ok(transactionManager.rollback.mock.calls.length > 0);
    });
  });

  describe("begin transaction failure", () => {
    it("should return error when begin returns null", async () => {
      transactionManager.begin.mock.mockImplementationOnce(
        () => null as unknown as Transaction,
      );

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.message.includes("Failed to begin transaction"));
      }
    });
  });

  describe("commit failure", () => {
    it("should return error when commit returns null", async () => {
      transactionManager.commit.mock.mockImplementationOnce(
        () => null as unknown as Transaction,
      );

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(
          result.error.message.includes("Failed to commit transaction"),
        );
      }
    });
  });
});
