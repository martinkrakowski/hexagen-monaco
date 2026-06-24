import { describe, it } from "vitest";
import assert from "node:assert";
import {
  isReportPhase,
  nextPhase,
  REPORT_PHASES,
} from "../../../src/domain/value-objects/report-phase.js";

describe("isReportPhase", () => {
  it("returns true for all valid phases", () => {
    for (const phase of REPORT_PHASES) {
      assert.strictEqual(isReportPhase(phase), true);
    }
  });

  it("returns false for invalid strings", () => {
    assert.strictEqual(isReportPhase("invalid"), false);
    assert.strictEqual(isReportPhase(""), false);
    assert.strictEqual(isReportPhase("05-deployment"), false);
  });
});

describe("nextPhase", () => {
  it("returns 02-implementation after 01-blueprint", () => {
    assert.strictEqual(nextPhase("01-blueprint"), "02-implementation");
  });

  it("returns 03-verification after 02-implementation", () => {
    assert.strictEqual(nextPhase("02-implementation"), "03-verification");
  });

  it("returns 04-remediation after 03-verification", () => {
    assert.strictEqual(nextPhase("03-verification"), "04-remediation");
  });

  it("returns null for last phase 04-remediation", () => {
    assert.strictEqual(nextPhase("04-remediation"), null);
  });
});

describe("REPORT_PHASES", () => {
  it("has length 4", () => {
    assert.strictEqual(REPORT_PHASES.length, 4);
  });
});
