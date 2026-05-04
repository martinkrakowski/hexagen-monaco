import assert from "node:assert/strict";
import { ReconcileUseCase } from "../../src/application/use-cases/reconcile.use-case.js";
import type {
  Patch,
  ReconciliationResult,
} from "../../src/domain/llm-response.js";
import { createVerdict } from "../../src/domain/verdict.js";

function createMockReconciliationPort(result: ReconciliationResult) {
  return {
    reconcile: jest.fn().mockResolvedValue(result),
  };
}

function createMockCompareVerdictsPort() {
  return {
    compareVerdicts: jest.fn().mockImplementation((a, b) => {
      if (a.accepted && !b.accepted) return -1;
      if (!a.accepted && b.accepted) return 1;
      return 0;
    }),
  };
}

function createMockResolveConflictPort() {
  return {
    resolve: jest.fn(),
  };
}

function createMockManifestPatchPort() {
  return {
    validatePatches: jest.fn().mockResolvedValue({ success: true, value: [] }),
    applyPatches: jest.fn().mockResolvedValue({ success: true }),
  };
}

function createMockLintFilterPort() {
  return {
    shouldAccept: jest.fn().mockReturnValue(true),
  };
}

function createPatch(id: string, targetId: string): Patch {
  return {
    id,
    targetId,
    type: "modify",
    payload: { file: targetId, content: "new content" },
    description: `Patch ${id}`,
  };
}

function createLintReport() {
  return {
    violations: [],
    warnings: [],
  };
}

describe("ReconcileUseCase", () => {
  describe("execute()", () => {
    it("should return diffResult when reconciliationPort.reconcile() fails", async () => {
      const failedResult = {
        success: false,
        patches: [],
        errors: ["reconciliation failed"],
      };
      const reconciliationPort = createMockReconciliationPort(failedResult);
      const useCase = new ReconcileUseCase(
        reconciliationPort,
        createMockCompareVerdictsPort(),
        createMockResolveConflictPort(),
      );

      const result = await useCase.execute({
        currentManifest: "",
        patches: [],
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.errors.includes("reconciliation failed"));
    });

    it("should generate verdicts and filter accepted patches", async () => {
      const patch1 = createPatch("p1", "file1");
      const patch2 = createPatch("p2", "file2");
      const diffResult = { success: true, patches: [patch1, patch2] };

      const reconciliationPort = createMockReconciliationPort(diffResult);
      const compareVerdictsPort = createMockCompareVerdictsPort();
      const useCase = new ReconcileUseCase(
        reconciliationPort,
        compareVerdictsPort,
        createMockResolveConflictPort(),
      );

      const result = await useCase.execute(
        { currentManifest: "", patches: [patch1, patch2] },
        "manifest.yaml",
        createLintReport(patch1),
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.patches.length, 2);
      assert.ok(result.summary.includes("2 patches applied"));
    });

    it("should apply patches when manifestPatchPort is provided", async () => {
      const patch1 = createPatch("p1", "file1");
      const diffResult = { success: true, patches: [patch1] };

      const reconciliationPort = createMockReconciliationPort(diffResult);
      const manifestPatchPort = createMockManifestPatchPort();
      const useCase = new ReconcileUseCase(
        reconciliationPort,
        createMockCompareVerdictsPort(),
        createMockResolveConflictPort(),
        manifestPatchPort,
      );

      await useCase.execute(
        { currentManifest: "manifest content", patches: [patch1] },
        "manifest.yaml",
      );

      assert.ok(manifestPatchPort.validatePatches.mock.calls.length > 0);
      assert.ok(manifestPatchPort.applyPatches.mock.calls.length > 0);
    });

    it("should use lintFilterPort when provided", async () => {
      const patch1 = createPatch("p1", "file1");
      const diffResult = { success: true, patches: [patch1] };

      const reconciliationPort = createMockReconciliationPort(diffResult);
      const lintFilterPort = createMockLintFilterPort();
      lintFilterPort.shouldAccept.mockReturnValue(false);

      const useCase = new ReconcileUseCase(
        reconciliationPort,
        createMockCompareVerdictsPort(),
        createMockResolveConflictPort(),
        undefined,
        lintFilterPort,
      );

      const result = await useCase.execute(
        { currentManifest: "", patches: [patch1] },
        undefined,
        createLintReport(patch1),
      );

      assert.ok(lintFilterPort.shouldAccept.mock.calls.length > 0);
      assert.strictEqual(result.patches.length, 0);
      assert.ok(result.summary.includes("0 patches applied"));
    });
  });

  describe("generateVerdicts()", () => {
    it("should create accepted verdict for patch without lint violations", () => {
      const patch = createPatch("p1", "file1");
      const useCase = new ReconcileUseCase(
        createMockReconciliationPort({ success: true, patches: [] }),
        createMockCompareVerdictsPort(),
        createMockResolveConflictPort(),
      );

      const verdicts = useCase["generateVerdicts"]([patch], undefined);

      assert.strictEqual(verdicts.length, 1);
      assert.strictEqual(verdicts[0].accepted, true);
      assert.ok(verdicts[0].reason.includes("Auto-accepted"));
    });

    it("should create rejected verdict when lintFilterPort rejects", () => {
      const patch = createPatch("p1", "file1");
      const lintFilterPort = createMockLintFilterPort();
      lintFilterPort.shouldAccept.mockReturnValue(false);

      const useCase = new ReconcileUseCase(
        createMockReconciliationPort({ success: true, patches: [] }),
        createMockCompareVerdictsPort(),
        createMockResolveConflictPort(),
        undefined,
        lintFilterPort,
      );

      const verdicts = useCase["generateVerdicts"]([patch], {
        violations: [],
        warnings: [],
      });

      assert.strictEqual(verdicts[0].accepted, false);
    });
  });

  describe("resolvePatchConflicts()", () => {
    it("should filter to only accepted verdicts", () => {
      const useCase = new ReconcileUseCase(
        createMockReconciliationPort({ success: true, patches: [] }),
        createMockCompareVerdictsPort(),
        createMockResolveConflictPort(),
      );

      const verdicts = [
        createVerdict("p1", true, "Accepted"),
        createVerdict("p2", false, "Rejected"),
        createVerdict("p3", true, "Accepted"),
      ];

      const resolved = useCase["resolvePatchConflicts"](verdicts);

      assert.strictEqual(resolved.length, 2);
      assert.strictEqual(resolved[0].patchId, "p1");
      assert.strictEqual(resolved[1].patchId, "p3");
    });
  });

  describe("extractAcceptedPatches()", () => {
    it("should return only patches with accepted verdicts", () => {
      const useCase = new ReconcileUseCase(
        createMockReconciliationPort({ success: true, patches: [] }),
        createMockCompareVerdictsPort(),
        createMockResolveConflictPort(),
      );

      const patches = [
        createPatch("p1", "f1"),
        createPatch("p2", "f2"),
        createPatch("p3", "f3"),
      ];
      const acceptedVerdicts = [
        createVerdict("p1", true, "OK"),
        createVerdict("p3", true, "OK"),
      ];

      const extracted = useCase["extractAcceptedPatches"](
        patches,
        acceptedVerdicts,
      );

      assert.strictEqual(extracted.length, 2);
      assert.strictEqual(extracted[0].id, "p1");
      assert.strictEqual(extracted[1].id, "p3");
    });
  });
});
