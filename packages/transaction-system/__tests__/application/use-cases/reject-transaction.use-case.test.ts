import assert from "node:assert/strict";
import { describe, it, beforeEach, vi } from "vitest";
import type { Transaction } from "../../../src/domain/transaction.js";
import type { TransactionManagerPort } from "../../../src/application/ports/in/transaction-manager.port.js";
import type { ManifestMutationPort } from "../../../src/application/ports/out/manifest-mutation.port.js";
import {
  RejectTransactionUseCase,
  DEFAULT_REJECTION_REASON,
} from "../../../src/application/use-cases/reject-transaction.use-case.js";

const MANIFEST = "/repo/.architecture/manifest.yaml";

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    intentId: "i-1",
    status: "speculative",
    createdAt: 0,
    updatedAt: 0,
    metadata: {},
    ...overrides,
  };
}

describe("RejectTransactionUseCase", () => {
  const get = vi.fn();
  const rollback = vi.fn();
  const restoreFromGit = vi.fn();

  let useCase: RejectTransactionUseCase;

  beforeEach(() => {
    for (const fn of [get, rollback, restoreFromGit]) fn.mockReset();

    get.mockReturnValue(makeTx());
    rollback.mockImplementation(() => makeTx({ status: "rolled_back" }));
    restoreFromGit.mockResolvedValue({ success: true, value: undefined });

    useCase = new RejectTransactionUseCase(
      { get, rollback } as unknown as TransactionManagerPort,
      { restoreFromGit } as unknown as ManifestMutationPort,
    );
  });

  const run = (reason?: string) =>
    useCase.execute({ transactionId: "tx-1", manifestPath: MANIFEST, reason });

  it("restores the manifest and rolls back, echoing the caller's reason", async () => {
    const outcome = await run("not what I meant");

    assert.equal(outcome.kind, "rejected");
    assert.equal(
      outcome.kind === "rejected" && outcome.reason,
      "not what I meant",
    );
    assert.deepEqual(restoreFromGit.mock.calls[0], [MANIFEST]);
    assert.deepEqual(rollback.mock.calls[0], ["tx-1", "not what I meant"]);
  });

  it("uses ONE default reason for both the rollback and the response", async () => {
    // The inline handler used "User rejected" for the audit trail and "User
    // rejected the changes" for the client, so the two disagreed about why the
    // same transaction was rolled back.
    const outcome = await run(undefined);

    assert.equal(
      outcome.kind === "rejected" && outcome.reason,
      DEFAULT_REJECTION_REASON,
    );
    assert.equal(rollback.mock.calls[0][1], DEFAULT_REJECTION_REASON);
  });

  it("reports not-found without restoring or rolling back", async () => {
    get.mockReturnValue(null);

    const outcome = await run();

    assert.equal(outcome.kind, "not-found");
    assert.equal(restoreFromGit.mock.calls.length, 0);
    assert.equal(rollback.mock.calls.length, 0);
  });

  it("refuses a transaction that is not speculative, carrying its status", async () => {
    get.mockReturnValue(makeTx({ status: "rolled_back" }));

    const outcome = await run();

    assert.equal(outcome.kind, "wrong-state");
    assert.equal(
      outcome.kind === "wrong-state" && outcome.status,
      "rolled_back",
    );
    assert.equal(restoreFromGit.mock.calls.length, 0);
  });

  it("rolls back even when the git restore fails (never stuck speculative)", async () => {
    const error = new Error("git boom");
    restoreFromGit.mockResolvedValue({ success: false, error });

    const outcome = await run("nope");

    assert.equal(outcome.kind, "restore-failed");
    assert.equal(outcome.kind === "restore-failed" && outcome.error, error);
    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(rollback.mock.calls[0][0], "tx-1");
  });
});
