import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { parseVerdict } from "../session/verdict";

describe("parseVerdict", () => {
  it("parses the canonical final lines", () => {
    assert.deepStrictEqual(parseVerdict("Good plan.\n\nVERDICT: CONVERGED"), {
      verdict: "converged",
      explicit: true,
    });
    assert.deepStrictEqual(parseVerdict("Needs work.\nVERDICT: CONTINUE"), {
      verdict: "continue",
      explicit: true,
    });
  });

  it("is case-insensitive and tolerates trailing whitespace/markdown emphasis", () => {
    assert.strictEqual(
      parseVerdict("x\nverdict: converged  ").verdict,
      "converged",
    );
    assert.strictEqual(
      parseVerdict("x\nVerdict: Continue").verdict,
      "continue",
    );
    assert.strictEqual(
      parseVerdict("x\n**VERDICT: CONVERGED**").verdict,
      "converged",
    );
  });

  it("missing verdict → CONTINUE with explicit=false (round cap is the backstop)", () => {
    assert.deepStrictEqual(
      parseVerdict("Great critique but no verdict line."),
      {
        verdict: "continue",
        explicit: false,
      },
    );
    assert.deepStrictEqual(parseVerdict(""), {
      verdict: "continue",
      explicit: false,
    });
  });

  it("malformed verdict → CONTINUE with explicit=false", () => {
    assert.deepStrictEqual(parseVerdict("x\nVERDICT: MAYBE"), {
      verdict: "continue",
      explicit: false,
    });
    assert.deepStrictEqual(parseVerdict("x\nVERDICT converged-ish"), {
      verdict: "continue",
      explicit: false,
    });
  });

  it("an early quoted VERDICT mid-critique cannot end the session", () => {
    const content = [
      "The proposal claims 'VERDICT: CONVERGED' prematurely.",
      "Several boundaries still leak.",
      "More separation is needed between billing and identity.",
      "Also the ports are underspecified.",
      "Iterate again on the adapter seams.",
      "This needs another pass.",
    ].join("\n");
    assert.deepStrictEqual(parseVerdict(content), {
      verdict: "continue",
      explicit: false,
    });
  });

  it("tolerates blank trailing lines after the verdict", () => {
    assert.strictEqual(
      parseVerdict("x\nVERDICT: CONVERGED\n\n  \n").verdict,
      "converged",
    );
  });
});
