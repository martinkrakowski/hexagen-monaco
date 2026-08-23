import assert from "node:assert/strict";
import { describe, it } from "vitest";
import rule from "../../src/rules/no-off-scale-spacing.js";
import { safeTemplateTokens } from "../../src/rules/class-string-tokens.js";

import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

type MessageIds = "offGrid" | "offScale";
type Options = [{ allowGridMultiples?: boolean }?];

/**
 * Runs the rule over a TEMPLATE literal, the way ESLint would: one
 * TemplateElement visit per chunk, each carrying its parent.
 *
 * `chunks` are the literal parts; the interpolations are the gaps between
 * them. `["mt-", " gap-1.5"]` is `` `mt-${x} gap-1.5` ``.
 */
function reportTemplate(chunks: readonly string[]): string[] {
  const reported: string[] = [];
  const context = {
    options: [{}],
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

  const quasis = chunks.map((raw) => ({
    type: "TemplateElement",
    value: { cooked: raw, raw },
  })) as unknown as TSESTree.TemplateElement[];
  const parent = {
    type: "TemplateLiteral",
    quasis,
  } as TSESTree.TemplateLiteral;
  for (const quasi of quasis) {
    (quasi as { parent?: unknown }).parent = parent;
    visitor.TemplateElement(quasi);
  }
  return reported;
}

// Classes built with backticks were invisible to both Tailwind rules -- the
// quiet kind of gap, where the rule reports nothing rather than reporting
// wrongly, so nothing ever looks broken. 24 violations lived there.
//
// The reason it was deferred is real, and these cases pin the answer: a
// template's chunks are split BY the interpolations, so a chunk's edges can
// hold half a token. Reporting `mt-` from `` `mt-${x}` `` would invent a
// violation; skipping a whole token because it merely sits near an expression
// would miss one.
describe("template literals are now classified", () => {
  it("reports an off-scale token inside a template", () => {
    assert.deepStrictEqual(reportTemplate(["flex gap-1.5"]), [
      "offGrid:gap-1.5",
    ]);
  });

  it("classifies interior tokens on both sides of an expression", () => {
    assert.deepStrictEqual(reportTemplate(["a mt-0.5 ", " py-1.5 b"]), [
      "offGrid:mt-0.5",
      "offGrid:py-1.5",
    ]);
  });

  it("leaves a template carrying no class tokens alone", () => {
    assert.deepStrictEqual(
      reportTemplate(["SELECT * FROM t WHERE id = ", ""]),
      [],
    );
  });
});

describe("boundary fragments are not guessed at", () => {
  it("does NOT report when the token's tail is an interpolation", () => {
    // `mt-${step}` is ONE token the author wrote. `mt-` is not a violation.
    assert.deepStrictEqual(reportTemplate(["mt-", ""]), []);
  });

  it("does NOT report when the token's head is an interpolation", () => {
    // `${size}-0.5` — the head is unknown, so the token cannot be classified.
    assert.deepStrictEqual(reportTemplate(["", "-0.5"]), []);
  });

  it("DOES report once whitespace proves the token is whole", () => {
    assert.deepStrictEqual(reportTemplate(["", " gap-1.5 ", ""]), [
      "offGrid:gap-1.5",
    ]);
  });

  it("treats the outer edges of the template as complete", () => {
    // Bounded by the backticks rather than by an expression.
    assert.deepStrictEqual(reportTemplate(["mt-0.5 ", ""]), ["offGrid:mt-0.5"]);
  });
});

describe("guards raised in review on #624", () => {
  it("classifies nothing when the chunk is not in its parent's quasis", () => {
    // `-1 < length - 1` is TRUE, so an unguarded indexOf would treat a foreign
    // node as preceding an expression and silently drop a real token.
    const orphan = {
      type: "TemplateElement",
      value: { cooked: "gap-1.5", raw: "gap-1.5" },
    } as unknown as TSESTree.TemplateElement;
    const parent = {
      type: "TemplateLiteral",
      quasis: [],
    } as unknown as TSESTree.TemplateLiteral;
    assert.deepStrictEqual(safeTemplateTokens(orphan, parent), []);
  });
});

describe("safeTemplateTokens, directly", () => {
  const parentOf = (chunks: string[]) => {
    const quasis = chunks.map((raw) => ({
      type: "TemplateElement",
      value: { cooked: raw, raw },
    })) as unknown as TSESTree.TemplateElement[];
    const parent = {
      type: "TemplateLiteral",
      quasis,
    } as TSESTree.TemplateLiteral;
    return { quasis, parent };
  };

  it("drops both edges when both abut an expression", () => {
    const { quasis, parent } = parentOf(["", "a-1.5", ""]);
    assert.deepStrictEqual(safeTemplateTokens(quasis[1], parent), []);
  });

  it("keeps an interior token between two abutting edges", () => {
    const { quasis, parent } = parentOf(["", "x gap-1.5 y", ""]);
    assert.deepStrictEqual(safeTemplateTokens(quasis[1], parent), ["gap-1.5"]);
  });

  it("returns nothing for an empty chunk", () => {
    const { quasis, parent } = parentOf(["", ""]);
    assert.deepStrictEqual(safeTemplateTokens(quasis[0], parent), []);
  });
});
