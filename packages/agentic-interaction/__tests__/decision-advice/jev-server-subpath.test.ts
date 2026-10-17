import { describe, expect, it } from "vitest";
import * as barrel from "../../src/index";

/**
 * Invariant 1: `JevDecisionAdapter` is exported only from the `./server`
 * subpath, never from the `.` barrel the client bundle imports.
 */
describe("JevDecisionAdapter server-subpath boundary", () => {
  it("is not exported from the `.` barrel", async () => {
    const module = await import("../../src/index");
    expect("JevDecisionAdapter" in module).toBe(false);
    expect("JevDecisionAdapter" in barrel).toBe(false);
  });
});
