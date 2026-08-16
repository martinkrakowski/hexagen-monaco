import assert from "node:assert/strict";
import { describe, it, beforeEach, vi } from "vitest";
import type { Patch } from "@hexagen/core-domain";
import type { Transaction } from "../../../src/domain/transaction.js";
import type { TransactionManagerPort } from "../../../src/application/ports/in/transaction-manager.port.js";
import type { ManifestMutationPort } from "../../../src/application/ports/out/manifest-mutation.port.js";
import type { LintValidationPort } from "../../../src/application/ports/out/lint-validation.port.js";
import { AcceptTransactionUseCase } from "../../../src/application/use-cases/accept-transaction.use-case.js";
import { createPatchMetadata } from "../../../src/domain/patch-metadata.js";

const MANIFEST = "/repo/.architecture/manifest.yaml";

const patch: Patch = {
  id: "p1",
  type: "add_node",
  targetId: "n1",
  payload: {},
};

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    intentId: "i-1",
    status: "speculative",
    createdAt: 0,
    updatedAt: 0,
    metadata: createPatchMetadata([patch]),
    ...overrides,
  };
}

describe("AcceptTransactionUseCase", () => {
  const get = vi.fn();
  const commit = vi.fn();
  const rollback = vi.fn();
  const applyPatches = vi.fn();
  const restoreFromGit = vi.fn();
  const validateManifest = vi.fn();

  let useCase: AcceptTransactionUseCase;

  beforeEach(() => {
    for (const fn of [
      get,
      commit,
      rollback,
      applyPatches,
      restoreFromGit,
      validateManifest,
    ]) {
      fn.mockReset();
    }

    get.mockReturnValue(makeTx());
    commit.mockImplementation(() => makeTx({ status: "committed" }));
    rollback.mockImplementation(() => makeTx({ status: "rolled_back" }));
    applyPatches.mockResolvedValue({ success: true, value: undefined });
    restoreFromGit.mockResolvedValue({ success: true, value: undefined });
    validateManifest.mockResolvedValue({
      success: true,
      value: { valid: true, errors: [] },
    });

    const transactionManager = {
      get,
      commit,
      rollback,
    } as unknown as TransactionManagerPort;
    const manifestMutation = {
      applyPatches,
      restoreFromGit,
    } as unknown as ManifestMutationPort;
    const lintValidation = {
      validateManifest,
    } as unknown as LintValidationPort;

    useCase = new AcceptTransactionUseCase(
      transactionManager,
      manifestMutation,
      lintValidation,
    );
  });

  const run = () =>
    useCase.execute({ transactionId: "tx-1", manifestPath: MANIFEST });

  it("commits on the happy path and reports the patch count", async () => {
    const outcome = await run();

    assert.equal(outcome.kind, "accepted");
    assert.equal(outcome.kind === "accepted" && outcome.patchesApplied, 1);
    assert.equal(commit.mock.calls.length, 1);
    assert.deepEqual(applyPatches.mock.calls[0], [[patch], MANIFEST]);
    assert.equal(restoreFromGit.mock.calls.length, 0);
  });

  it("reports not-found without touching the manifest", async () => {
    get.mockReturnValue(null);

    const outcome = await run();

    assert.equal(outcome.kind, "not-found");
    assert.equal(applyPatches.mock.calls.length, 0);
    assert.equal(rollback.mock.calls.length, 0);
  });

  it("refuses a transaction that is not speculative, carrying its status", async () => {
    get.mockReturnValue(makeTx({ status: "committed" }));

    const outcome = await run();

    assert.equal(outcome.kind, "wrong-state");
    assert.equal(outcome.kind === "wrong-state" && outcome.status, "committed");
    assert.equal(applyPatches.mock.calls.length, 0);
  });

  it("rejects invalid patch metadata and still rolls the transaction back", async () => {
    // Nothing reached disk, so there is nothing to restore — but leaving the
    // transaction `speculative` would leak it (and its backpressure slot).
    get.mockReturnValue(makeTx({ metadata: { patches: "oops" } }));

    const outcome = await run();

    assert.equal(outcome.kind, "invalid-patch-metadata");
    assert.equal(applyPatches.mock.calls.length, 0);
    assert.equal(commit.mock.calls.length, 0);
    assert.equal(restoreFromGit.mock.calls.length, 0);
    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(rollback.mock.calls[0][0], "tx-1");
  });

  it("compensates a failed apply — restore THEN rollback, never committed", async () => {
    const error = new Error("bad patch");
    applyPatches.mockResolvedValue({ success: false, error });

    const outcome = await run();

    assert.equal(outcome.kind, "apply-failed");
    assert.equal(outcome.kind === "apply-failed" && outcome.error, error);
    assert.equal(
      outcome.kind === "apply-failed" && outcome.restoreFailure,
      undefined,
    );
    assert.deepEqual(restoreFromGit.mock.calls[0], [MANIFEST]);
    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(commit.mock.calls.length, 0);
  });

  it("still rolls back when the compensating restore itself fails", async () => {
    // The Wave-1 (#441) invariant, now enforced on every compensating arm: an
    // on-disk `git checkout` failure must not strand the in-memory transaction.
    const restoreError = new Error("git checkout failed");
    applyPatches.mockResolvedValue({
      success: false,
      error: new Error("bad patch"),
    });
    restoreFromGit.mockResolvedValue({ success: false, error: restoreError });

    const outcome = await run();

    assert.equal(outcome.kind, "apply-failed");
    assert.equal(
      outcome.kind === "apply-failed" && outcome.restoreFailure,
      restoreError,
    );
    assert.equal(rollback.mock.calls.length, 1);
  });

  it("separates an unrunnable linter from a lint violation", async () => {
    const error = new Error("lint CLI crashed");
    validateManifest.mockResolvedValue({ success: false, error });

    const outcome = await run();

    assert.equal(outcome.kind, "lint-unavailable");
    assert.equal(outcome.kind === "lint-unavailable" && outcome.error, error);
    // The patches WERE applied before the linter was asked, so they must come
    // back out even though nothing is known about their validity.
    assert.equal(restoreFromGit.mock.calls.length, 1);
    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(commit.mock.calls.length, 0);
  });

  it("reports a lint violation with its errors, reverted", async () => {
    validateManifest.mockResolvedValue({
      success: true,
      value: { valid: false, errors: ["boom", "bang"] },
    });

    const outcome = await run();

    assert.equal(outcome.kind, "lint-violation");
    assert.deepEqual(outcome.kind === "lint-violation" && outcome.lintErrors, [
      "boom",
      "bang",
    ]);
    assert.equal(restoreFromGit.mock.calls.length, 1);
    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(commit.mock.calls.length, 0);
  });

  it("flags the manual-intervention state when lint fails AND restore fails", async () => {
    const restoreError = new Error("git checkout failed");
    validateManifest.mockResolvedValue({
      success: true,
      value: { valid: false, errors: ["boom"] },
    });
    restoreFromGit.mockResolvedValue({ success: false, error: restoreError });

    const outcome = await run();

    assert.equal(outcome.kind, "lint-violation");
    assert.equal(
      outcome.kind === "lint-violation" && outcome.restoreFailure,
      restoreError,
    );
    assert.equal(rollback.mock.calls.length, 1);
  });

  it("passes the manifest path through unchanged to both ports", async () => {
    // The use case does NO path resolution — the anchoring is the caller's job
    // (AUD-002). If it ever started rewriting the path, the adapters and the
    // route's traversal gate would disagree again.
    validateManifest.mockResolvedValue({
      success: true,
      value: { valid: false, errors: ["boom"] },
    });

    await useCase.execute({
      transactionId: "tx-1",
      manifestPath: "/other/root/.architecture/manifest.yaml",
    });

    assert.equal(
      applyPatches.mock.calls[0][1],
      "/other/root/.architecture/manifest.yaml",
    );
    assert.equal(
      restoreFromGit.mock.calls[0][0],
      "/other/root/.architecture/manifest.yaml",
    );
    assert.equal(
      validateManifest.mock.calls[0][0],
      "/other/root/.architecture/manifest.yaml",
    );
  });

  /**
   * `TransactionManagerPort.commit()` is nullable, and null means "not
   * committed" — the transaction is already terminal, i.e. an overlapping
   * request finalised it during the two awaits above. Falling back to the
   * stale `tx` read at the top of `execute` reported a commit that never
   * happened, as HTTP 200 `status:"committed"`.
   */
  describe("commit() refused (concurrent finalisation)", () => {
    it("does not report `accepted` off a stale transaction when commit returns null", async () => {
      commit.mockReturnValue(null);
      get
        .mockReturnValueOnce(makeTx())
        .mockReturnValue(makeTx({ status: "rolled_back" }));

      const outcome = await run();

      assert.notEqual(outcome.kind, "accepted");
      assert.equal(outcome.kind, "commit-conflict");
      assert.equal(
        outcome.kind === "commit-conflict" && outcome.status,
        "rolled_back",
      );
    });

    it("reverts the manifest when the winner was a REJECT", async () => {
      // Our patches may have landed after the reject's restore. The status that
      // stuck is `rolled_back`, so the file must not keep them.
      commit.mockReturnValue(null);
      get
        .mockReturnValueOnce(makeTx())
        .mockReturnValue(makeTx({ status: "rolled_back" }));

      await run();

      assert.equal(restoreFromGit.mock.calls.length, 1);
      assert.deepEqual(restoreFromGit.mock.calls[0], [MANIFEST]);
    });

    it("flags manual intervention when that reverting restore also fails", async () => {
      commit.mockReturnValue(null);
      get
        .mockReturnValueOnce(makeTx())
        .mockReturnValue(makeTx({ status: "rolled_back" }));
      const restoreError = new Error("git boom");
      restoreFromGit.mockResolvedValue({ success: false, error: restoreError });

      const outcome = await run();

      assert.equal(outcome.kind, "commit-conflict");
      assert.equal(
        outcome.kind === "commit-conflict" && outcome.restoreFailure,
        restoreError,
      );
    });

    it("reports success WITHOUT reverting when the winner was another ACCEPT", async () => {
      // A concurrent accept applied the same patch set from the same metadata
      // and passed the same lint gate. The manifest is already correct, so
      // restoring it would revert legitimately committed patches.
      commit.mockReturnValue(null);
      const winner = makeTx({ status: "committed" });
      get.mockReturnValueOnce(makeTx()).mockReturnValue(winner);

      const outcome = await run();

      assert.equal(outcome.kind, "accepted");
      assert.equal(outcome.kind === "accepted" && outcome.transaction, winner);
      assert.equal(restoreFromGit.mock.calls.length, 0);
    });
  });
});
