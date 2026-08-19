import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { classifyScanExit } from "./classify-scan-exit";

describe("classifyScanExit", () => {
  it("classifies exit 0 as pass", () => {
    assert.equal(classifyScanExit(0), "pass");
  });

  it("classifies exit 1 as violations", () => {
    assert.equal(classifyScanExit(1), "violations");
  });

  it("classifies exit 2 as could-not-run", () => {
    assert.equal(classifyScanExit(2), "could-not-run");
  });

  it("classifies unknown numeric codes as could-not-run, never pass", () => {
    assert.equal(classifyScanExit(127), "could-not-run");
    assert.equal(classifyScanExit(3), "could-not-run");
  });

  it("classifies spawn failures (ENOENT, null) as could-not-run", () => {
    assert.equal(classifyScanExit("ENOENT"), "could-not-run");
    assert.equal(classifyScanExit(null), "could-not-run");
  });
});
