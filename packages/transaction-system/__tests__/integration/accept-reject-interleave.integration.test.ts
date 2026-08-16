import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import type { Patch } from "@hexagen/core-domain";
import { InMemoryTransactionManager } from "../../src/infrastructure/adapters/in-memory-transaction-manager.adapter.js";
import { AcceptTransactionUseCase } from "../../src/application/use-cases/accept-transaction.use-case.js";
import { RejectTransactionUseCase } from "../../src/application/use-cases/reject-transaction.use-case.js";
import { createPatchMetadata } from "../../src/domain/patch-metadata.js";
import type { ManifestMutationPort } from "../../src/application/ports/out/manifest-mutation.port.js";
import type { LintValidationPort } from "../../src/application/ports/out/lint-validation.port.js";
import type { Result } from "../../src/application/result.js";

/**
 * Accept and reject overlap on one transaction.
 *
 * Both sagas read `speculative`, then do awaited filesystem work, then write a
 * terminal status. Before this change the manager took every terminal write
 * unconditionally, so the last writer won and the surviving status could
 * contradict the manifest on disk — a `committed` transaction whose manifest
 * had been restored, or a `rolled_back` one whose patches were still applied.
 *
 * These run the REAL InMemoryTransactionManager (the fakes are only the two
 * filesystem-facing ports) and assert the property that matters: when both
 * sagas have settled, the transaction's status and the manifest's contents
 * agree.
 */

const MANIFEST = "/repo/.architecture/manifest.yaml";

const patch: Patch = {
  id: "p1",
  type: "add_node",
  targetId: "n1",
  payload: {},
};

const OK: Result<void, Error> = { success: true, value: undefined };

/** A manifest file reduced to the only bit these tests care about. */
class FakeManifest implements ManifestMutationPort {
  patchesOnDisk = false;
  /** Resolves the next `applyPatches`/`restoreFromGit` only when released. */
  private gate: Promise<void> = Promise.resolve();
  private release: () => void = () => {};

  block(): void {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  unblock(): void {
    this.release();
  }

  async applyPatches(): Promise<Result<void, Error>> {
    await this.gate;
    this.patchesOnDisk = true;
    return OK;
  }

  async restoreFromGit(): Promise<Result<void, Error>> {
    this.patchesOnDisk = false;
    return OK;
  }
}

class PassingLint implements LintValidationPort {
  gate: Promise<void> = Promise.resolve();
  async validateManifest(): Promise<
    Result<{ valid: boolean; errors: string[] }, Error>
  > {
    await this.gate;
    return { success: true, value: { valid: true, errors: [] } };
  }
}

describe("accept/reject interleaved on one transaction", () => {
  let manager: InMemoryTransactionManager;
  let manifest: FakeManifest;
  let lint: PassingLint;
  let txId: string;

  beforeEach(() => {
    manager = new InMemoryTransactionManager();
    manifest = new FakeManifest();
    lint = new PassingLint();

    const tx = manager.begin("intent-1", createPatchMetadata([patch]));
    manager.transition(tx.id, "speculative");
    txId = tx.id;
  });

  const accept = () =>
    new AcceptTransactionUseCase(manager, manifest, lint).execute({
      transactionId: txId,
      manifestPath: MANIFEST,
    });

  const reject = () =>
    new RejectTransactionUseCase(manager, manifest).execute({
      transactionId: txId,
      manifestPath: MANIFEST,
    });

  it("a reject landing mid-accept wins, and the manifest ends up agreeing", async () => {
    // Accept reads `speculative`, then stalls inside applyPatches.
    manifest.block();
    const accepting = accept();

    // Reject runs to completion in that window.
    const rejected = await reject();
    assert.equal(rejected.kind, "rejected");
    assert.equal(manager.get(txId)?.status, "rolled_back");

    // Accept resumes: it applies its patches (after the reject's restore), the
    // lint passes, and only then does it discover it has lost.
    manifest.unblock();
    const accepted = await accepting;

    assert.equal(accepted.kind, "commit-conflict");
    assert.equal(
      accepted.kind === "commit-conflict" && accepted.status,
      "rolled_back",
    );
    // The property: status and disk agree. Pre-fix this transaction ended
    // `committed` (accept's unconditional commit overwrote the reject) with the
    // patches still on disk — a rolled-back reject the client was told had
    // succeeded.
    assert.equal(manager.get(txId)?.status, "rolled_back");
    assert.equal(manifest.patchesOnDisk, false);
  });

  it("a reject arriving after the accept committed is refused, keeping the committed manifest", async () => {
    const accepted = await accept();
    assert.equal(accepted.kind, "accepted");
    assert.equal(manifest.patchesOnDisk, true);

    const rejected = await reject();

    assert.equal(rejected.kind, "wrong-state");
    assert.equal(
      rejected.kind === "wrong-state" && rejected.status,
      "committed",
    );
    assert.equal(manager.get(txId)?.status, "committed");
    // A reject that lost must not revert the winner's patches.
    assert.equal(manifest.patchesOnDisk, true);
  });

  it("two overlapping accepts settle on one commit, not a conflict", async () => {
    // Both read `speculative`; the first to reach commit() wins. The loser
    // applied the same patch set and passed the same lint gate, so it reports
    // the same success instead of reverting a correct manifest.
    let releaseLint: () => void = () => {};
    lint.gate = new Promise<void>((resolve) => {
      releaseLint = resolve;
    });
    const first = accept();
    await Promise.resolve();

    lint.gate = Promise.resolve();
    const second = await accept();
    assert.equal(second.kind, "accepted");

    releaseLint();
    const firstOutcome = await first;

    assert.equal(firstOutcome.kind, "accepted");
    assert.equal(manager.get(txId)?.status, "committed");
    assert.equal(manifest.patchesOnDisk, true);
  });

  it("the manager refuses a second terminal write outright", async () => {
    assert.notEqual(manager.commit(txId), null);
    assert.equal(manager.commit(txId), null);
    assert.equal(manager.rollback(txId, "too late"), null);
    assert.equal(manager.get(txId)?.status, "committed");
  });
});
