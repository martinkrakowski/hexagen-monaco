import assert from "node:assert/strict";
import { describe, it } from "vitest";
import rule from "../../src/rules/no-off-scale-spacing.js";

import type { TSESLint } from "@typescript-eslint/utils";

type MessageIds = "offGrid" | "offScale";
type Options = [{ allowGridMultiples?: boolean }?];

/** One reported violation, flattened to `<messageId>:<token>` for assertions. */
type Reported = string;

function makeVisitor(options: Options = [{}]) {
  const reported: Reported[] = [];
  const context = {
    options,
    report: (args: TSESLint.ReportDescriptor<MessageIds>) => {
      if ("data" in args && args.data && "token" in args.data) {
        const messageId = "messageId" in args ? args.messageId : "?";
        reported.push(`${String(messageId)}:${String(args.data.token)}`);
      }
    },
  } as unknown as TSESLint.RuleContext<MessageIds, Options>;
  const visitor = rule.create(context) as Record<
    string,
    (node: unknown) => void
  >;
  return { reported, visitor };
}

/** Runs the rule over one string literal and returns what it reported. */
function report(classString: string, options: Options = [{}]): Reported[] {
  const { reported, visitor } = makeVisitor(options);
  visitor.Literal({ value: classString } as never);
  return reported;
}

/** The same run, keeping the full `data` payload each report carried. */
function reportData(classString: string): Array<Record<string, unknown>> {
  const seen: Array<Record<string, unknown>> = [];
  const visitor = rule.create({
    options: [{}],
    report: (args: TSESLint.ReportDescriptor<MessageIds>) => {
      if ("data" in args && args.data) seen.push(args.data);
    },
  } as unknown as TSESLint.RuleContext<MessageIds, Options>) as Record<
    string,
    (node: unknown) => void
  >;
  visitor.Literal({ value: classString } as never);
  return seen;
}

describe("no-off-scale-spacing", () => {
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

  describe("the violations that shipped (PR #614, RepoEntryView.tsx)", () => {
    // The rule exists because these two reached main. `no-arbitrary-tailwind-
    // values` matches BRACKETED values only, so a named off-scale step never
    // entered its grammar, and no other gate walks `features/`.
    it("reports mt-0.5", () => {
      assert.deepStrictEqual(report("mt-0.5"), ["offGrid:mt-0.5"]);
    });

    it("reports gap-1.5", () => {
      assert.deepStrictEqual(report("gap-1.5"), ["offGrid:gap-1.5"]);
    });

    it("reports both inside a realistic className", () => {
      assert.deepStrictEqual(
        report("flex items-center gap-1.5 rounded-md px-3 py-2 mt-0.5"),
        ["offGrid:gap-1.5", "offGrid:mt-0.5"],
      );
    });

    it("names the px value, not just the class", () => {
      // 0.5 × 4px = 2px — the message has to be concrete about WHY the step is
      // off the grid, not quote the class back at the author.
      assert.deepStrictEqual(reportData("mt-0.5 gap-1.5 p-5"), [
        { token: "mt-0.5", px: "2" },
        { token: "gap-1.5", px: "6" },
        { token: "p-5", px: "20" },
      ]);
    });
  });

  describe("the whole spacing family, not one prefix", () => {
    it("reports every margin side and axis", () => {
      assert.deepStrictEqual(
        report("m-0.5 mx-2.5 my-3.5 mt-0.5 mr-1.5 mb-2.5 ml-3.5 ms-0.5 me-1.5"),
        [
          "offGrid:m-0.5",
          "offGrid:mx-2.5",
          "offGrid:my-3.5",
          "offGrid:mt-0.5",
          "offGrid:mr-1.5",
          "offGrid:mb-2.5",
          "offGrid:ml-3.5",
          "offGrid:ms-0.5",
          "offGrid:me-1.5",
        ],
      );
    });

    it("reports every padding side and axis", () => {
      assert.deepStrictEqual(
        report("p-0.5 px-1.5 py-2.5 pt-3.5 pr-0.5 pb-1.5 pl-2.5 ps-3.5 pe-0.5"),
        [
          "offGrid:p-0.5",
          "offGrid:px-1.5",
          "offGrid:py-2.5",
          "offGrid:pt-3.5",
          "offGrid:pr-0.5",
          "offGrid:pb-1.5",
          "offGrid:pl-2.5",
          "offGrid:ps-3.5",
          "offGrid:pe-0.5",
        ],
      );
    });

    it("reports gap on both axes", () => {
      assert.deepStrictEqual(report("gap-2.5 gap-x-1.5 gap-y-0.5"), [
        "offGrid:gap-2.5",
        "offGrid:gap-x-1.5",
        "offGrid:gap-y-0.5",
      ]);
    });

    it("reports space-x / space-y", () => {
      assert.deepStrictEqual(report("space-y-1.5 space-x-0.5"), [
        "offGrid:space-y-1.5",
        "offGrid:space-x-0.5",
      ]);
    });

    it("reports scroll-margin and scroll-padding", () => {
      assert.deepStrictEqual(report("scroll-mt-1.5 scroll-p-0.5"), [
        "offGrid:scroll-mt-1.5",
        "offGrid:scroll-p-0.5",
      ]);
    });
  });

  describe("utilities whose numbers are NOT spacing steps", () => {
    // The main way this rule goes wrong is a regex that treats every number
    // after a dash as a scale step. Each of these is a different scale.
    it("ignores z-index", () => {
      assert.deepStrictEqual(report("z-50 z-10"), []);
    });

    it("ignores transition durations and delays", () => {
      assert.deepStrictEqual(report("duration-300 duration-150 delay-75"), []);
    });

    it("ignores border widths", () => {
      assert.deepStrictEqual(report("border-2 border-t-4 ring-2"), []);
    });

    it("ignores opacity", () => {
      assert.deepStrictEqual(report("opacity-50 opacity-90"), []);
    });

    it("ignores grid track counts and spans", () => {
      assert.deepStrictEqual(report("grid-cols-12 col-span-2 row-span-3"), []);
    });

    it("ignores type scale and leading", () => {
      assert.deepStrictEqual(report("text-2xl leading-5 tracking-2"), []);
    });

    it("ignores flex/order/basis numbers", () => {
      assert.deepStrictEqual(report("flex-1 order-2 basis-1/2"), []);
    });

    it("ignores sizing utilities — deliberately out of scope", () => {
      // `h-9` is the shipped control height, `h-3.5 w-3.5` is a Lucide glyph.
      // §4.7's table names p/m/gap; sizing is not rhythm. See the rule's
      // SPACING_UTILITIES comment.
      assert.deepStrictEqual(
        report("h-9 h-3.5 w-3.5 size-3.5 w-48 min-w-0 max-w-2xl"),
        [],
      );
    });

    it("ignores positioning utilities — deliberately out of scope", () => {
      assert.deepStrictEqual(
        report("inset-0 top-1/2 -translate-y-1/2 -top-0.5 left-3.5 right-2.5"),
        [],
      );
    });
  });

  describe("legal spellings that are not off-scale", () => {
    it("allows every step in the DESIGN.md §4.7 table", () => {
      assert.deepStrictEqual(
        report("p-1 m-2 gap-3 px-4 py-6 mt-8 mb-12 space-y-16"),
        [],
      );
    });

    it("allows zero — the absence of spacing is not off the grid", () => {
      assert.deepStrictEqual(report("px-0 m-0 gap-0 space-y-0 p-0"), []);
    });

    it("allows mx-auto and its siblings", () => {
      assert.deepStrictEqual(report("mx-auto ml-auto my-auto m-auto"), []);
    });

    it("allows m-px / p-px", () => {
      // A hairline has no representation on a 4px scale. Strictly it is 1px
      // and therefore off-grid; it is allowed as a category, the way §4.8
      // allows var(--token) references.
      assert.deepStrictEqual(report("m-px p-px -mt-px"), []);
    });

    it("allows space-x-reverse", () => {
      assert.deepStrictEqual(report("space-x-reverse space-y-reverse"), []);
    });

    it("allows negative steps that are on the scale", () => {
      assert.deepStrictEqual(report("-mt-4 -mx-2 -space-x-1"), []);
    });

    it("reports a negative step that is off the scale", () => {
      // The sign does not change which scale the magnitude comes from.
      assert.deepStrictEqual(report("-mt-0.5 -mx-2.5"), [
        "offGrid:-mt-0.5",
        "offGrid:-mx-2.5",
      ]);
    });

    it("allows a clean className end to end", () => {
      assert.deepStrictEqual(
        report(
          "flex items-center gap-2 p-4 rounded-lg bg-card border-2 z-10 duration-150",
        ),
        [],
      );
    });
  });

  describe("variants and the important modifier cannot walk past the rule", () => {
    it("reports a breakpoint variant", () => {
      assert.deepStrictEqual(report("md:mt-0.5"), ["offGrid:md:mt-0.5"]);
    });

    it("reports a state variant", () => {
      assert.deepStrictEqual(report("hover:gap-1.5"), [
        "offGrid:hover:gap-1.5",
      ]);
    });

    // Regression, raised in review on #617. The previous regex parser consumed
    // NEITHER of these -- `[^\]]*` stopped at the first `]`, and `[\w-]+` has
    // no `/` -- so the variant stayed attached, the remainder no longer looked
    // like a spacing utility, and the token was SILENTLY SKIPPED. A rule that
    // reports nothing is harder to notice than one that reports wrongly.
    // Raised by PR-Agent on #617, against the regex this file replaced: a
    // LEADING `!` (canonical Tailwind v3 important) sat before the variant, so
    // `[\w-]+:` never matched, the variant was never stripped, and the token
    // was silently skipped -- a false negative that would have defeated the
    // `error` gate in components/primitives/**. The bracket-depth scanner fixes
    // it incidentally (`!` is an ordinary character before the `:`), which is
    // exactly why it is pinned here rather than left to coincidence.
    it("reports a LEADING important modifier before a variant", () => {
      assert.deepStrictEqual(report("!hover:mt-0.5"), [
        "offGrid:!hover:mt-0.5",
      ]);
      assert.deepStrictEqual(report("!hover:gap-1.5"), [
        "offGrid:!hover:gap-1.5",
      ]);
    });

    it("reports behind a NAMED group variant (slash)", () => {
      assert.deepStrictEqual(report("group-hover/item:mt-0.5"), [
        "offGrid:group-hover/item:mt-0.5",
      ]);
    });

    it("reports behind a NESTED arbitrary variant", () => {
      assert.deepStrictEqual(report("[&>[data-active]+span]:gap-1.5"), [
        "offGrid:[&>[data-active]+span]:gap-1.5",
      ]);
    });

    it("reports a stack of variants", () => {
      assert.deepStrictEqual(report("group-hover:md:mt-0.5"), [
        "offGrid:group-hover:md:mt-0.5",
      ]);
    });

    it("reports behind an arbitrary data-variant", () => {
      // A naive `[\w-]+:` variant prefix cannot consume `data-[state=open]:`,
      // which would leave this token unclassified — a variant would be enough
      // to bypass the rule.
      assert.deepStrictEqual(report("data-[state=open]:px-1.5"), [
        "offGrid:data-[state=open]:px-1.5",
      ]);
    });

    it("reports behind an arbitrary selector variant", () => {
      assert.deepStrictEqual(report("[&>svg]:mr-1.5"), [
        "offGrid:[&>svg]:mr-1.5",
      ]);
    });

    it("reports a v3 important prefix", () => {
      assert.deepStrictEqual(report("!mt-0.5"), ["offGrid:!mt-0.5"]);
    });

    it("reports a v4 important suffix", () => {
      assert.deepStrictEqual(report("mt-0.5!"), ["offGrid:mt-0.5!"]);
    });

    it("reports important behind a variant", () => {
      assert.deepStrictEqual(report("hover:!gap-1.5"), [
        "offGrid:hover:!gap-1.5",
      ]);
    });

    it("reports important combined with a negative sign, either order", () => {
      assert.deepStrictEqual(report("!-mt-2.5 -!mb-2.5"), [
        "offGrid:!-mt-2.5",
        "offGrid:-!mb-2.5",
      ]);
    });

    it("reports the WHOLE token the author wrote, not the stripped core", () => {
      // A message quoting `mt-0.5` for source that says `md:hover:!mt-0.5` is
      // a string that does not appear in the file.
      assert.deepStrictEqual(report("md:hover:!mt-0.5"), [
        "offGrid:md:hover:!mt-0.5",
      ]);
    });
  });

  describe("arbitrary values belong to no-arbitrary-tailwind-values", () => {
    it("does not double-report a bracketed spacing value", () => {
      assert.deepStrictEqual(report("mt-[3px] gap-[6px] p-[0.5rem]"), []);
    });

    it("does not report a var(--token) spacing reference", () => {
      assert.deepStrictEqual(report("p-[var(--card-gap)]"), []);
    });

    it("still reports a named violation sharing a string with a bracket", () => {
      // The per-token failure mode the sibling rule already suffered once: a
      // whole-string pre-filter let one unparseable class exempt every other
      // class beside it. There is no pre-filter here.
      assert.deepStrictEqual(report("w-[calc(100%-2rem)] gap-1.5"), [
        "offGrid:gap-1.5",
      ]);
    });

    it("still reports a named violation beside a `%` class", () => {
      assert.deepStrictEqual(report("max-w-[85%] mt-0.5"), ["offGrid:mt-0.5"]);
    });
  });

  describe("on-grid steps that are off the §4.7 table", () => {
    // DESIGN.md is not self-consistent here: §4.7's PROSE says "a multiple of
    // 4px" (p-5 = 20px passes), its TABLE enumerates eight steps, and §7.3
    // uses p-5 as its worked example of a violation. The default follows the
    // table and §7.3; `allowGridMultiples` names the looser reading so the
    // wiring can be ratcheted.
    it("reports p-5 by default, as DESIGN.md §7.3 does", () => {
      assert.deepStrictEqual(report("p-5"), ["offScale:p-5"]);
    });

    it("reports the other integer steps off the table", () => {
      assert.deepStrictEqual(report("mb-7 pl-10 gap-x-10 mb-14 py-20"), [
        "offScale:mb-7",
        "offScale:pl-10",
        "offScale:gap-x-10",
        "offScale:mb-14",
        "offScale:py-20",
      ]);
    });

    it("allows them under allowGridMultiples", () => {
      assert.deepStrictEqual(
        report("p-5 mb-7 pl-10", [{ allowGridMultiples: true }]),
        [],
      );
    });

    it("still reports fractional steps under allowGridMultiples", () => {
      // The option relaxes the TABLE, never the 4px grid itself — 2px and 6px
      // are off the grid on any reading of §4.7.
      assert.deepStrictEqual(
        report("p-5 mt-0.5 gap-1.5", [{ allowGridMultiples: true }]),
        ["offGrid:mt-0.5", "offGrid:gap-1.5"],
      );
    });

    it("treats an absent options array as the strict default", () => {
      assert.deepStrictEqual(report("p-5", [] as unknown as Options), [
        "offScale:p-5",
      ]);
    });
  });

  describe("token stream hygiene", () => {
    it("tolerates newlines and runs of whitespace between classes", () => {
      assert.deepStrictEqual(report("flex\n  mt-0.5\t gap-2"), [
        "offGrid:mt-0.5",
      ]);
    });

    it("ignores an empty string", () => {
      assert.deepStrictEqual(report(""), []);
    });

    it("ignores a bare utility with no value", () => {
      assert.deepStrictEqual(report("flex gap block"), []);
    });

    it("does not match a spacing name embedded in a longer word", () => {
      // `lastIndexOf('-')` splits `foo/mt-0.5` into `foo/mt` + `0.5`, which is
      // not in the utility set — a path or identifier is not a class.
      assert.deepStrictEqual(report("components/mt-0.5"), []);
    });
  });
});
