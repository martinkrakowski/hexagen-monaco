import assert from "node:assert/strict";
import { VerdictComparatorAdapter } from "../infrastructure/adapters/verdict-comparator.adapter.js";
import { createVerdict } from "../domain/verdict.js";

describe("VerdictComparatorAdapter", () => {
  let adapter: VerdictComparatorAdapter;

  beforeEach(() => {
    adapter = new VerdictComparatorAdapter();
  });

  it("should rank accepted verdicts before rejected ones", () => {
    const accepted = createVerdict("p1", true, "OK");
    const rejected = createVerdict("p2", false, "Not OK");

    assert.strictEqual(adapter.compareVerdicts(accepted, rejected), -1);
    assert.strictEqual(adapter.compareVerdicts(rejected, accepted), 1);
  });

  it("should rank governance-blocked verdicts lower", () => {
    const blocked = createVerdict(
      "p1",
      true,
      "shared-kernel-removal attempted",
    );
    const normal = createVerdict("p2", true, "OK");

    assert.strictEqual(adapter.compareVerdicts(blocked, normal), 1);
    assert.strictEqual(adapter.compareVerdicts(normal, blocked), -1);
  });

  it("should rank cross-boundary-port-injection as governance blocked", () => {
    const blocked = createVerdict(
      "p1",
      true,
      "cross-boundary-port-injection detected",
    );
    const normal = createVerdict("p2", true, "OK");

    assert.strictEqual(adapter.compareVerdicts(blocked, normal), 1);
  });

  it("should rank invariant-violation as governance blocked", () => {
    const blocked = createVerdict("p1", true, "invariant-violation found");
    const normal = createVerdict("p2", true, "OK");

    assert.strictEqual(adapter.compareVerdicts(blocked, normal), 1);
  });

  it("should rank by timestamp when other criteria are equal", () => {
    const older = createVerdict("p1", true, "OK");
    older.timestamp = 1000;
    const newer = createVerdict("p2", true, "OK");
    newer.timestamp = 2000;

    assert.strictEqual(adapter.compareVerdicts(older, newer), -1);
    assert.strictEqual(adapter.compareVerdicts(newer, older), 1);
  });

  it("should return 0 for identical verdicts", () => {
    const verdict = createVerdict("p1", true, "OK");

    assert.strictEqual(adapter.compareVerdicts(verdict, verdict), 0);
  });
});
