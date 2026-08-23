import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Linter } from "eslint";
import rule from "../../src/rules/population-guard.js";

/**
 * Fixtures run through ESLint's real Linter (flat mode, espree) rather than
 * the sibling tests' hand-rolled fake nodes: this rule depends on traversal
 * order, parent chains and comments, all of which fake nodes would have to
 * fake — and a fixture that fakes the mechanism under test proves nothing.
 */
function lint(code: string): string[] {
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(
    code,
    [
      {
        files: ["**/*.test.ts"],
        plugins: {
          // Linter's plugin typing predates typescript-eslint's RuleModule;
          // structurally compatible at runtime.
          "hexagen-ui": { rules: { "population-guard": rule } } as never,
        },
        rules: { "hexagen-ui/population-guard": "error" },
      },
    ],
    "fixture.test.ts",
  );
  return messages.map((m) => `${m.ruleId ?? "parse-error"}:${m.message}`);
}

const FLAG = (msgs: string[]) =>
  msgs.filter((m) => m.includes("population-guard")).length;

describe("population-guard", () => {
  it("exports a rule object with meta and create", () => {
    assert.ok(rule.meta);
    assert.ok(typeof rule.create === "function");
  });

  // ---- must flag ----------------------------------------------------------

  it("flags .not.toContain with no guard (#626's vacuous shape)", () => {
    const msgs = lint(`
      it("carries no residue", () => {
        const lines = render(fixture);
        expect(lines).not.toContain("fellThrough");
      });
    `);
    assert.equal(FLAG(msgs), 1, msgs.join("\n"));
  });

  it("flags toEqual([]) on a call result (#616's emptied-list shape)", () => {
    const msgs = lint(`
      it("collects nothing unexpected", () => {
        expect(collectViolations(files)).toEqual([]);
      });
    `);
    assert.equal(FLAG(msgs), 1, msgs.join("\n"));
  });

  it("flags toStrictEqual([]) on an awaited call result", () => {
    const msgs = lint(`
      it("scan is clean", async () => {
        expect(await scan(root)).toStrictEqual([]);
      });
    `);
    assert.equal(FLAG(msgs), 1, msgs.join("\n"));
  });

  it("flags .not.toMatch with no guard", () => {
    const msgs = lint(`
      it("has no error text", () => {
        const html = container.innerHTML;
        expect(html).not.toMatch(/error/);
      });
    `);
    assert.equal(FLAG(msgs), 1, msgs.join("\n"));
  });

  it("flags .not.toHaveLength(0), which is not itself a guard", () => {
    const msgs = lint(`
      it("is not empty… allegedly", () => {
        expect(items).not.toHaveLength(0);
        expect(items).not.toContain("bad");
      });
    `);
    // the first line is a flagged negative AND must not guard the second
    assert.equal(FLAG(msgs), 2, msgs.join("\n"));
  });

  it("a guard AFTER the negative does not suppress the report", () => {
    const msgs = lint(`
      it("guards too late", () => {
        expect(items).not.toContain("bad");
        expect(items).toHaveLength(3);
      });
    `);
    assert.equal(FLAG(msgs), 1, msgs.join("\n"));
  });

  it("a guard on a DIFFERENT subject does not count", () => {
    const msgs = lint(`
      it("guards the wrong thing", () => {
        expect(other).toHaveLength(2);
        expect(items).not.toContain("bad");
      });
    `);
    assert.equal(FLAG(msgs), 1, msgs.join("\n"));
  });

  it("a guard in a SIBLING test does not leak into this one", () => {
    const msgs = lint(`
      it("first", () => {
        expect(items).toHaveLength(2);
      });
      it("second", () => {
        expect(items).not.toContain("bad");
      });
    `);
    assert.equal(FLAG(msgs), 1, msgs.join("\n"));
  });

  // ---- must not flag ------------------------------------------------------

  it("toHaveLength(n>0) before the negative guards it", () => {
    const msgs = lint(`
      it("guarded", () => {
        expect(items).toHaveLength(3);
        expect(items).not.toContain("bad");
      });
    `);
    assert.equal(FLAG(msgs), 0, msgs.join("\n"));
  });

  it("expect(x.length).toBeGreaterThan(0) guards it", () => {
    const msgs = lint(`
      it("guarded", () => {
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings).not.toContain("boom");
      });
    `);
    assert.equal(FLAG(msgs), 0, msgs.join("\n"));
  });

  it("assert.ok(x.length > 0) guards it (node:assert style)", () => {
    const msgs = lint(`
      it("guarded assert-style", () => {
        assert.ok(entries.length > 0, "non-empty first");
        expect(entries).not.toContain("dead");
      });
    `);
    assert.equal(FLAG(msgs), 0, msgs.join("\n"));
  });

  it("assert.strictEqual(x.length, n>0) guards it", () => {
    const msgs = lint(`
      it("guarded assert-style", () => {
        assert.strictEqual(rows.length, 4);
        expect(rows).not.toMatch(/error/);
      });
    `);
    assert.equal(FLAG(msgs), 0, msgs.join("\n"));
  });

  it("allow-list comment on the same line suppresses", () => {
    const msgs = lint(`
      it("intentionally empty", () => {
        expect(warningsFor(cleanInput)).toEqual([]); // population-guard: clean input produces no warnings by design
      });
    `);
    assert.equal(FLAG(msgs), 0, msgs.join("\n"));
  });

  it("allow-list comment on the line above suppresses", () => {
    const msgs = lint(`
      it("intentionally empty", () => {
        // population-guard: clean fixture; emptiness is the expectation
        expect(warningsFor(cleanInput)).toEqual([]);
      });
    `);
    assert.equal(FLAG(msgs), 0, msgs.join("\n"));
  });

  it("a bare population-guard comment with no reason does NOT suppress", () => {
    const msgs = lint(`
      it("no reason given", () => {
        // population-guard:
        expect(warningsFor(cleanInput)).toEqual([]);
      });
    `);
    assert.equal(FLAG(msgs), 1, msgs.join("\n"));
  });

  it("negative shapes outside a test body are out of scope", () => {
    const msgs = lint(`
      function helperAssertClean(lines) {
        expect(lines).not.toContain("bad");
      }
    `);
    assert.equal(FLAG(msgs), 0, msgs.join("\n"));
  });

  it("toEqual([]) on an identifier (not a call result) is not flagged", () => {
    const msgs = lint(`
      it("documented limitation", () => {
        const out = residue();
        expect(out).toEqual([]);
      });
    `);
    assert.equal(FLAG(msgs), 0, msgs.join("\n"));
  });

  it("expect(x).toHaveLength(0) asserts intentional emptiness and is not flagged", () => {
    const msgs = lint(`
      it("explicit empty", () => {
        expect(items).toHaveLength(0);
      });
    `);
    assert.equal(FLAG(msgs), 0, msgs.join("\n"));
  });

  it("works inside it.each and it.only bodies", () => {
    const msgs = lint(`
      it.each([1, 2])("case %d", () => {
        expect(items).not.toContain("bad");
      });
      it.only("focused", () => {
        expect(items).toHaveLength(1);
        expect(items).not.toContain("bad");
      });
    `);
    assert.equal(FLAG(msgs), 1, msgs.join("\n"));
  });
});
