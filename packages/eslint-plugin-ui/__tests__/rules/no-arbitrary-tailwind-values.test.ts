import assert from "node:assert/strict";
import { describe, it } from "vitest";
import rule from "../../src/rules/no-arbitrary-tailwind-values.js";

import type { TSESLint } from "@typescript-eslint/utils";

function makeVisitor() {
  const reported: string[] = [];
  const context = {
    report: (args: TSESLint.ReportDescriptor<"arbitraryValue">) => {
      if ("data" in args && args.data && "value" in args.data) {
        reported.push(String(args.data.value));
      }
    },
  } as unknown as TSESLint.RuleContext<"arbitraryValue", []>;
  const visitor = rule.create(context) as Record<
    string,
    (node: unknown) => void
  >;
  return { reported, visitor };
}

/** Runs the rule over one string literal and returns what it reported. */
function report(classString: string): string[] {
  const { reported, visitor } = makeVisitor();
  visitor.Literal({ value: classString } as never);
  return reported;
}

describe("no-arbitrary-tailwind-values", () => {
  it("exports a rule object with meta and create", () => {
    assert.ok(rule.meta);
    assert.ok(typeof rule.create === "function");
  });

  it("meta is configured with problem type", () => {
    assert.strictEqual(rule.meta.type, "problem");
  });

  it("ignores non-string literals", () => {
    const { reported, visitor } = makeVisitor();
    visitor.Literal({ value: 42 } as never);
    visitor.Literal({ value: null } as never);
    assert.deepStrictEqual(reported, []);
  });

  describe("baseline detection (DESIGN.md §1 examples)", () => {
    it("reports w-[347px]", () => {
      assert.deepStrictEqual(report("w-[347px] p-4"), ["w-[347px]"]);
    });

    it("reports text-[13px]", () => {
      assert.deepStrictEqual(report("text-sm text-[13px]"), ["text-[13px]"]);
    });

    it("reports bare scale-[0.98]", () => {
      assert.deepStrictEqual(report("scale-[0.98] p-4"), ["scale-[0.98]"]);
    });

    it("reports hover:scale-[0.98] — the exception is active: only", () => {
      assert.deepStrictEqual(report("hover:scale-[0.98] p-4"), [
        "hover:scale-[0.98]",
      ]);
    });

    it("reports every violation in a multi-class string", () => {
      assert.deepStrictEqual(report("w-[347px] flex text-[13px]"), [
        "w-[347px]",
        "text-[13px]",
      ]);
    });

    it("reports the full token including its utility prefix, not a suffix", () => {
      // Guards a real reporting defect: the utility group used to be `\w+`,
      // which cannot match the `-` in `max-w`, so `max-w-[85%]` was reported
      // as `w-[85%]` — a string that does not appear in the source and that
      // no exception entry could ever match.
      assert.deepStrictEqual(report("max-w-[85%]"), ["max-w-[85%]"]);
    });

    it("allows a clean className", () => {
      assert.deepStrictEqual(
        report("flex items-center gap-2 p-4 rounded-lg bg-card"),
        [],
      );
    });
  });

  describe("values the pre-filter used to swallow", () => {
    // REGRESSION FENCE. The visitor was guarded by a whole-string allowlist
    // (/^[\w\s\-[\]/:.\-#]+$/) that omitted `%`, `(` and `)`. Any className
    // containing one of those characters was discarded BEFORE the arbitrary
    // pattern ran, so these cases passed silently — the rule never executed.
    it("reports w-[85%]", () => {
      assert.deepStrictEqual(report("w-[85%]"), ["w-[85%]"]);
    });

    it("reports max-w-[85%] in a real chat-bubble className", () => {
      assert.deepStrictEqual(
        report("flex flex-col gap-1 max-w-[85%] rounded-lg px-3 py-2"),
        ["max-w-[85%]"],
      );
    });

    it("reports w-[calc(100%-2rem)]", () => {
      assert.deepStrictEqual(report("w-[calc(100%-2rem)]"), [
        "w-[calc(100%-2rem)]",
      ]);
    });

    it("reports h-[calc(100%-28px)]", () => {
      assert.deepStrictEqual(
        report("h-[calc(100%-28px)] flex items-center justify-center px-2"),
        ["h-[calc(100%-28px)]"],
      );
    });

    it("reports an arbitrary shadow carrying a slash-opacity color", () => {
      assert.deepStrictEqual(
        report(
          "bg-primary/15 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]",
        ),
        ["shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"],
      );
    });

    it("still reports a clean violation sharing a string with a `%` class", () => {
      // The exact failure mode of the old pre-filter: one `%` anywhere in the
      // string suppressed EVERY class in it, including plainly-spelled ones.
      assert.deepStrictEqual(report("w-[85%] text-[13px]"), [
        "w-[85%]",
        "text-[13px]",
      ]);
    });
  });

  describe("documented exceptions (DESIGN.md §4.8)", () => {
    it("allows active:scale-[0.98]", () => {
      assert.deepStrictEqual(report("active:scale-[0.98] p-4"), []);
    });

    it("allows a var(--token) reference", () => {
      assert.deepStrictEqual(
        report("p-0 h-[var(--resizable-panel-height)]"),
        [],
      );
    });

    it("allows a var(--token) reference behind a variant", () => {
      assert.deepStrictEqual(report("sm:max-w-[var(--card-width-md)]"), []);
    });

    it("allows transition-[box-shadow,border-color] property lists", () => {
      assert.deepStrictEqual(
        report("transition-[box-shadow,border-color]"),
        [],
      );
    });

    it("allows will-change-[transform]", () => {
      assert.deepStrictEqual(report("will-change-[transform]"), []);
    });
  });

  describe("the token-reference allowance does not launder magic numbers", () => {
    it("reports calc() over a token reference", () => {
      assert.deepStrictEqual(report("h-[calc(var(--card-width-md)-4px)]"), [
        "h-[calc(var(--card-width-md)-4px)]",
      ]);
    });

    it("reports a var() reference carrying a literal fallback", () => {
      assert.deepStrictEqual(report("w-[var(--card-width-md,280px)]"), [
        "w-[var(--card-width-md,280px)]",
      ]);
    });

    it("reports a var() reference wrapped in a color function", () => {
      assert.deepStrictEqual(report("text-[hsl(var(--primary))]"), [
        "text-[hsl(var(--primary))]",
      ]);
    });

    it("reports a duration hiding behind a property-list utility", () => {
      assert.deepStrictEqual(report("transition-[300ms]"), [
        "transition-[300ms]",
      ]);
    });

    it("reports an arbitrary property list on a non-property-list utility", () => {
      assert.deepStrictEqual(report("grid-cols-[auto,1fr]"), [
        "grid-cols-[auto,1fr]",
      ]);
    });
  });

  describe("bracket syntaxes that are not arbitrary values", () => {
    it("ignores arbitrary variants (data-[state=…])", () => {
      assert.deepStrictEqual(
        report("w-1.5 data-[resize-handle-state=drag]:bg-accent"),
        [],
      );
    });

    it("ignores arbitrary selector variants ([&>svg]:size-4)", () => {
      assert.deepStrictEqual(report("[&>svg]:size-4"), []);
    });

    it("ignores a bracket embedded mid-token", () => {
      assert.deepStrictEqual(report("items[0]-value"), []);
    });

    it("tolerates newlines and runs of whitespace between classes", () => {
      assert.deepStrictEqual(report("flex\n  w-[347px]\t p-4"), ["w-[347px]"]);
    });
  });

  describe("the important modifier cannot be used to walk past the rule", () => {
    // Tailwind spells `!important` two ways: v3 prefixes the utility, v4
    // suffixes the token. Neither was matched before, so `!w-[85%]` was
    // simply not a violation -- a one-character bypass of the whole rule.
    it("reports a v3 important prefix", () => {
      assert.deepStrictEqual(report("!w-[85%]"), ["!w-[85%]"]);
    });

    it("reports a v3 important prefix behind a variant", () => {
      assert.deepStrictEqual(report("hover:!w-[347px]"), ["hover:!w-[347px]"]);
    });

    it("reports a v4 important suffix", () => {
      assert.deepStrictEqual(report("w-[85%]!"), ["w-[85%]!"]);
    });

    it("still exempts a documented exception when marked important", () => {
      // The exception is about the VALUE, so exempting active:scale-[0.98]
      // but reporting active:!scale-[0.98] would be an accident of spelling.
      assert.deepStrictEqual(report("active:!scale-[0.98]"), []);
    });

    it("still exempts a token reference when marked important", () => {
      assert.deepStrictEqual(report("!h-[var(--resizable-panel-height)]"), []);
    });

    it("still exempts a property list when marked important", () => {
      assert.deepStrictEqual(
        report("!transition-[box-shadow,border-color]"),
        [],
      );
    });
  });
});
