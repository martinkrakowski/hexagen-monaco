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

    expect(adapter.compareVerdicts(accepted, rejected)).toBe(-1);
    expect(adapter.compareVerdicts(rejected, accepted)).toBe(1);
  });

  it("should rank governance-blocked verdicts lower", () => {
    const blocked = createVerdict(
      "p1",
      true,
      "shared-kernel-removal attempted",
    );
    const normal = createVerdict("p2", true, "OK");

    expect(adapter.compareVerdicts(blocked, normal)).toBe(1);
    expect(adapter.compareVerdicts(normal, blocked)).toBe(-1);
  });

  it("should rank cross-boundary-port-injection as governance blocked", () => {
    const blocked = createVerdict(
      "p1",
      true,
      "cross-boundary-port-injection detected",
    );
    const normal = createVerdict("p2", true, "OK");

    expect(adapter.compareVerdicts(blocked, normal)).toBe(1);
  });

  it("should rank invariant-violation as governance blocked", () => {
    const blocked = createVerdict("p1", true, "invariant-violation found");
    const normal = createVerdict("p2", true, "OK");

    expect(adapter.compareVerdicts(blocked, normal)).toBe(1);
  });

  it("should rank by timestamp when other criteria are equal", () => {
    const older = createVerdict("p1", true, "OK");
    older.timestamp = 1000;
    const newer = createVerdict("p2", true, "OK");
    newer.timestamp = 2000;

    expect(adapter.compareVerdicts(older, newer)).toBe(-1);
    expect(adapter.compareVerdicts(newer, older)).toBe(1);
  });

  it("should return 0 for identical verdicts", () => {
    const verdict = createVerdict("p1", true, "OK");

    expect(adapter.compareVerdicts(verdict, verdict)).toBe(0);
  });
});
