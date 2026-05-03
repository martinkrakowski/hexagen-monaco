import { ReconcileUseCase } from "../../src/application/use-cases/reconcile.use-case.js";
import type {
  Patch,
  ReconciliationResult,
} from "../../src/domain/llm-response.js";
import { createVerdict } from "../../src/domain/verdict.js";

// ─── Mocks ───────────────────────────────────────────────────────────────

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

// ─── Test Data ─────────────────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────

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

      expect(result.success).toBe(false);
      expect(result.errors).toContain("reconciliation failed");
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

      expect(result.success).toBe(true);
      expect(result.patches).toHaveLength(2);
      expect(result.summary).toContain("2 patches applied");
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

      expect(manifestPatchPort.validatePatches).toHaveBeenCalled();
      expect(manifestPatchPort.applyPatches).toHaveBeenCalled();
    });

    it("should use lintFilterPort when provided", async () => {
      const patch1 = createPatch("p1", "file1");
      const diffResult = { success: true, patches: [patch1] };

      const reconciliationPort = createMockReconciliationPort(diffResult);
      const lintFilterPort = createMockLintFilterPort();
      lintFilterPort.shouldAccept.mockReturnValue(false); // Reject all patches

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

      expect(lintFilterPort.shouldAccept).toHaveBeenCalled();
      expect(result.patches).toHaveLength(0); // All rejected
      expect(result.summary).toContain("0 patches applied");
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

      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].accepted).toBe(true);
      expect(verdicts[0].reason).toContain("Auto-accepted");
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

      expect(verdicts[0].accepted).toBe(false);
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

      expect(resolved).toHaveLength(2);
      expect(resolved[0].patchId).toBe("p1");
      expect(resolved[1].patchId).toBe("p3");
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

      expect(extracted).toHaveLength(2);
      expect(extracted[0].id).toBe("p1");
      expect(extracted[1].id).toBe("p3");
    });
  });
});
