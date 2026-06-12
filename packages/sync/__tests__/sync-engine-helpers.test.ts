/**
 * Merge-seam contracts for the engine helpers (PR-B2 + review follow-ups).
 *
 * Error propagation only — the bucket/totalOps dedup semantics of
 * mergeBarrelPasses are pinned end-to-end by the check-drift contract suite
 * (exact "1 pending change" messages over the built dist), which is the
 * stronger oracle. What CANNOT be pinned end-to-end is the `error` field's
 * survival through the merges: no live generator on the barrel path fails
 * soft today (recursive throws — the A1 hard-fail path), so the only possible
 * oracle for the seam is unit-level. The propagation is visibility, not
 * arithmetic: SyncRunSummary.errors is counted at the production sites
 * (noteFailure per pass result) BEFORE either merge runs.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { createEmptyResult } from "../src/results.js";
import { mergeBarrelPasses, mergeResult } from "../src/sync-engine-helpers.js";

describe("merge seams preserve failed-soft errors (visibility, not arithmetic)", () => {
  it("mergeResult: first error wins, later errors don't overwrite", () => {
    const dest = createEmptyResult();
    const first = createEmptyResult();
    first.error = new Error("alpha failed");
    first.summary = "alpha summary";
    const second = createEmptyResult();
    second.error = new Error("beta failed");
    second.summary = "beta summary";

    mergeResult(dest, first);
    mergeResult(dest, second);

    assert.strictEqual(dest.error?.message, "alpha failed");
    assert.strictEqual(dest.summary, "alpha summary");
  });

  it("mergeBarrelPasses: a pass-1 error survives the from-scratch rebuild", () => {
    const firstPass = createEmptyResult();
    firstPass.error = new Error("pass-1 barrel failure");
    firstPass.summary = "pass-1 summary";
    const secondPass = createEmptyResult();

    const combined = mergeBarrelPasses(firstPass, secondPass);

    assert.strictEqual(combined.error?.message, "pass-1 barrel failure");
    assert.strictEqual(combined.summary, "pass-1 summary");
    assert.strictEqual(
      combined.totalOps,
      0,
      "an error is not an op — totalOps stays bucket-derived",
    );
  });

  it("mergeBarrelPasses: a pass-2 error surfaces when pass 1 succeeded; pass 1 wins when both fail", () => {
    const cleanFirst = createEmptyResult();
    const failingSecond = createEmptyResult();
    failingSecond.error = new Error("pass-2 barrel failure");
    failingSecond.summary = "pass-2 summary";

    const fromSecond = mergeBarrelPasses(cleanFirst, failingSecond);
    assert.strictEqual(fromSecond.error?.message, "pass-2 barrel failure");
    assert.strictEqual(fromSecond.summary, "pass-2 summary");

    const failingFirst = createEmptyResult();
    failingFirst.error = new Error("pass-1 barrel failure");
    failingFirst.summary = "pass-1 summary";
    const bothFailed = mergeBarrelPasses(failingFirst, failingSecond);
    assert.strictEqual(
      bothFailed.error?.message,
      "pass-1 barrel failure",
      "first error wins — same rule as mergeResult",
    );
  });

  it("mergeBarrelPasses: no error in, no error out (fields stay unset)", () => {
    const combined = mergeBarrelPasses(
      createEmptyResult(),
      createEmptyResult(),
    );
    assert.strictEqual(combined.error, undefined);
    assert.strictEqual(combined.summary, undefined);
  });
});
