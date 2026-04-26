import type { Transaction } from "../../../src/domain/transaction.js";
import type { TransactionManagerPort } from "../../../src/application/ports/in/transaction-manager.port.js";
import type { ManifestMutationPort } from "../../../src/application/ports/out/manifest-mutation.port.js";
import type { LintValidationPort } from "../../../src/application/ports/out/lint-validation.port.js";
import type { Patch, IntentLineage } from "@hexagen/core-domain";
import { CommitPatchesUseCase } from "../../../src/application/use-cases/commit-patches.use-case.js";

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
  let transactionManager: jest.Mocked<TransactionManagerPort>;
  let manifestMutation: jest.Mocked<ManifestMutationPort>;
  let lintValidation: jest.Mocked<LintValidationPort>;

  beforeEach(() => {
    transactionManager = {
      begin: jest.fn().mockReturnValue(makeTransaction()),
      transition: jest
        .fn()
        .mockReturnValue(makeTransaction({ status: "speculative" })),
      get: jest.fn().mockReturnValue(makeTransaction()),
      list: jest.fn().mockReturnValue([]),
      commit: jest
        .fn()
        .mockReturnValue(makeTransaction({ status: "committed" })),
      rollback: jest
        .fn()
        .mockReturnValue(makeTransaction({ status: "rolled_back" })),
    };

    manifestMutation = {
      applyPatches: jest
        .fn()
        .mockResolvedValue({ success: true, value: undefined }),
      restoreFromGit: jest
        .fn()
        .mockResolvedValue({ success: true, value: undefined }),
    };

    lintValidation = {
      validateManifest: jest.fn().mockResolvedValue({
        success: true,
        value: { valid: true, errors: [] },
      }),
    };

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

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.status).toBe("committed");
      }

      expect(transactionManager.begin).toHaveBeenCalledWith(
        "intent-1",
        expect.objectContaining({ intentId: "intent-1" }),
      );
      expect(transactionManager.transition).toHaveBeenCalledWith(
        "txn-test-1",
        "speculative",
      );
      expect(manifestMutation.applyPatches).toHaveBeenCalledWith(
        patches,
        "/path/to/manifest.yaml",
      );
      expect(lintValidation.validateManifest).toHaveBeenCalledWith(
        "/path/to/manifest.yaml",
      );
      expect(transactionManager.commit).toHaveBeenCalledWith("txn-test-1");
    });
  });

  describe("patch application failure", () => {
    it("should rollback and restore from git when applyPatches fails", async () => {
      manifestMutation.applyPatches.mockResolvedValueOnce({
        success: false,
        error: new Error("disk full"),
      });

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("disk full");
      }

      expect(manifestMutation.restoreFromGit).toHaveBeenCalledWith(
        "/path/to/manifest.yaml",
      );
      expect(transactionManager.rollback).toHaveBeenCalledWith(
        "txn-test-1",
        expect.stringContaining("Patch application failed"),
      );
      expect(transactionManager.commit).not.toHaveBeenCalled();
    });
  });

  describe("lint validation failure", () => {
    it("should rollback and restore from git when lint returns invalid", async () => {
      lintValidation.validateManifest.mockResolvedValueOnce({
        success: true,
        value: {
          valid: false,
          errors: ["port in >1 context", "missing adapter"],
        },
      });

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("port in >1 context");
      }

      expect(manifestMutation.restoreFromGit).toHaveBeenCalledWith(
        "/path/to/manifest.yaml",
      );
      expect(transactionManager.rollback).toHaveBeenCalledWith(
        "txn-test-1",
        expect.stringContaining("Lint validation failed"),
      );
      expect(transactionManager.commit).not.toHaveBeenCalled();
    });
  });

  describe("lint validation error", () => {
    it("should rollback when lint throws an error", async () => {
      lintValidation.validateManifest.mockResolvedValueOnce({
        success: false,
        error: new Error("linter crashed"),
      });

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("linter crashed");
      }

      expect(manifestMutation.restoreFromGit).toHaveBeenCalledWith(
        "/path/to/manifest.yaml",
      );
      expect(transactionManager.rollback).toHaveBeenCalled();
    });
  });

  describe("begin transaction failure", () => {
    it("should return error when begin returns null", async () => {
      transactionManager.begin.mockReturnValueOnce(
        null as unknown as Transaction,
      );

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Failed to begin transaction");
      }
    });
  });

  describe("commit failure", () => {
    it("should return error when commit returns null", async () => {
      transactionManager.commit.mockReturnValueOnce(
        null as unknown as Transaction,
      );

      const result = await useCase.execute(
        [],
        makeLineage(),
        "/path/to/manifest.yaml",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Failed to commit transaction");
      }
    });
  });
});
