import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

type MessageIds = "offGrid" | "offScale";
type Options = [{ allowGridMultiples?: boolean }?];

/**
 * The spacing scale of DESIGN.md §4.7, as STEPS (Tailwind's default `spacing`
 * scale is `0.25rem × step`, so step × 4 = px at a 16px root —
 * `apps/web/tailwind.config.ts` extends `theme` but does NOT override
 * `spacing`, so the default scale is what ships).
 *
 * `0` is on the list although §4.7's table starts at 1: zero spacing is the
 * absence of spacing, not a value off the grid, and `p-0` / `gap-0` are the
 * documented way to cancel an inherited step.
 */
const SCALE_STEPS = new Set([0, 1, 2, 3, 4, 6, 8, 12, 16]);

/** px per scale step — used only to make the message concrete. */
const PX_PER_STEP = 4;

/**
 * Axis and side suffixes shared by `margin` and `padding`, including the
 * logical-property pair (`ms`/`me`, `ps`/`pe`). The empty string yields the
 * bare `m` / `p`.
 */
const SIDES = ["", "x", "y", "t", "r", "b", "l", "s", "e"];

/**
 * The utilities this rule owns: those that put SPACE BETWEEN OR AROUND boxes.
 *
 * That line is the whole scope decision, and it is drawn deliberately.
 * Tailwind's `spacing` theme key also feeds utilities that SIZE a box
 * (`w`, `h`, `size`, `min-*`, `max-*`) and utilities that POSITION one
 * (`inset`, `top`/`right`/`bottom`/`left`, `translate-x/y`). Those are
 * excluded:
 *
 *   - SIZING is not rhythm. `h-9` is the shipped control height, `h-3.5 w-3.5`
 *     is a Lucide glyph sized to its optical box, and `max-w-2xl` is a named
 *     measure token. Enforcing the §4.7 step list on them would demand a
 *     redesign of every control and icon in the app, which §4.7 does not ask
 *     for — its table names `p-*`, `m-*` and `gap-*` and nothing else.
 *   - POSITIONING is a coordinate, not a gap. `-top-0.5` on an absolutely
 *     positioned badge is optical alignment against a glyph, and the family's
 *     other spellings (`top-1/2`, `inset-0`, `inset-x-auto`) are not scale
 *     values at all.
 *
 * `scroll-m*` / `scroll-p*` ARE included: they are scroll-margin and
 * scroll-padding — the same box spacing, applied at a scroll snap — with no
 * fraction or keyword spelling to confuse. The repo has no uses today, so
 * they cost nothing now and are closed before the first one appears.
 */
const SPACING_UTILITIES = new Set<string>([
  ...SIDES.map((side) => `m${side}`),
  ...SIDES.map((side) => `p${side}`),
  ...SIDES.map((side) => `scroll-m${side}`),
  ...SIDES.map((side) => `scroll-p${side}`),
  "gap",
  "gap-x",
  "gap-y",
  "space-x",
  "space-y",
]);

/**
 * ONE variant prefix, consumed left to right: `hover:`, `md:`,
 * `group-hover:`, `peer-focus:`, and the bracketed forms `data-[state=open]:`,
 * `supports-[display:grid]:`, `[&>svg]:`.
 *
 * The bracketed alternatives matter: a naive `[\w-]+:` prefix cannot consume
 * `data-[state=open]:`, so `data-[state=open]:px-1.5` would fall out of the
 * grammar and go unreported — a variant would be enough to walk past the rule.
 */
const VARIANT_PREFIX = /^(?:\[[^\]]*\]|[\w-]+(?:-\[[^\]]*\])?):/;

/**
 * A bare numeric scale value. Deliberately narrow, so the other spellings a
 * spacing utility accepts fall out of the grammar and are NOT reported:
 * `auto` (`mx-auto`), `px` (`m-px`, a hairline no step can express),
 * `reverse` (`space-x-reverse`), and fractions (`1/2`), which carry a `/`.
 * A token this rule cannot classify is simply not a match.
 */
const NUMERIC_VALUE = /^\d+(?:\.\d+)?$/;

/**
 * Flags Tailwind spacing utilities whose step is not on the DESIGN.md §4.7
 * scale — the gap that let `mt-0.5` (2px) and `gap-1.5` (6px) ship.
 *
 * WHY A SEPARATE RULE FROM `no-arbitrary-tailwind-values`: that rule matches
 * BRACKETED values (`mt-[3px]`). An off-scale NAMED step is spelled with no
 * brackets at all, so it never enters that rule's grammar. The two are
 * complements, and this rule deliberately skips any token containing a bracket
 * so a single class is never reported twice.
 *
 * Classification is PER TOKEN, for the reason spelled out at length in
 * `no-arbitrary-tailwind-values`: an earlier revision of that rule pre-filtered
 * the WHOLE className string against a character allowlist, so one
 * unrecognised character silently exempted every class in the string. There is
 * no whole-string pre-filter here either.
 *
 * Scope note, shared with `no-arbitrary-tailwind-values`: only string `Literal`
 * nodes are inspected. Classes assembled inside template literals
 * (`` `… ${x} mt-0.5` ``) are `TemplateElement` nodes and are NOT seen — a
 * known gap in both rules, to be closed for both at once.
 */
const rule: TSESLint.RuleModule<MessageIds, Options> = {
  defaultOptions: [{}],
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce the DESIGN.md §4.7 spacing scale on Tailwind margin, padding, gap and space utilities",
    },
    messages: {
      offGrid:
        'Spacing utility "{{token}}" resolves to {{px}}px, which is off the 4px baseline grid. DESIGN.md §4.7 defines the scale as 1, 2, 3, 4, 6, 8, 12, 16 (0 cancels). Use the nearest step.',
      offScale:
        'Spacing utility "{{token}}" resolves to {{px}}px. That is on the 4px grid but not on the DESIGN.md §4.7 scale — 1, 2, 3, 4, 6, 8, 12, 16 (0 cancels). Use the nearest step.',
    },
    schema: [
      {
        type: "object",
        properties: {
          /**
           * Accept ANY integer step (every one is a 4px multiple) instead of
           * only the eight steps §4.7 tabulates.
           *
           * This exists because DESIGN.md is not self-consistent here: §4.7's
           * prose says "all spacing must resolve to a multiple of 4px" — under
           * which `p-5` (20px) passes — while its table enumerates eight steps
           * and §7.3 uses `p-5` as its worked example of a violation. The
           * strict reading (the table) is the default; this option names the
           * looser one so a wiring can be ratcheted rather than negotiated in
           * the rule body.
           */
          allowGridMultiples: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allowGridMultiples = context.options[0]?.allowGridMultiples === true;

    return {
      Literal(node: TSESTree.Literal) {
        if (typeof node.value !== "string") return;

        // A className is a token stream: classify each token on its own, so
        // one unrecognised token can never suppress the rest of the string.
        for (const token of node.value.split(/\s+/)) {
          if (token === "") continue;

          // Consume every variant prefix, so `md:hover:mt-0.5` is classified
          // on `mt-0.5` and reported as the whole token the author wrote.
          let rest = token;
          for (;;) {
            const variant = VARIANT_PREFIX.exec(rest);
            if (variant === null) break;
            rest = rest.slice(variant[0].length);
          }

          // Strip the important modifier in BOTH Tailwind spellings (v3
          // prefixes the utility, v4 suffixes the token) and the negative
          // sign, in either order — `!-mt-3.5` and `-!mt-3.5` both occur.
          // A negative step consumes the same scale as its positive twin, so
          // only the magnitude is classified; `-mt-4` stays legal.
          for (;;) {
            if (rest.startsWith("!") || rest.startsWith("-")) {
              rest = rest.slice(1);
              continue;
            }
            break;
          }
          if (rest.endsWith("!")) rest = rest.slice(0, -1);

          // Arbitrary values are `no-arbitrary-tailwind-values`' job. Bailing
          // on any residual bracket keeps `mt-[3px]` from being reported
          // twice, and keeps a bracket the variant loop could not consume from
          // being mis-split below.
          if (rest.includes("[") || rest.includes("]")) continue;

          // Values never contain a dash, so the LAST dash separates the
          // utility from its value: `space-y-2` → `space-y` + `2`,
          // `gap-x-10` → `gap-x` + `10`, `mt-0.5` → `mt` + `0.5`.
          const separator = rest.lastIndexOf("-");
          if (separator <= 0) continue;

          const utility = rest.slice(0, separator);
          const value = rest.slice(separator + 1);

          if (!SPACING_UTILITIES.has(utility)) continue;
          if (!NUMERIC_VALUE.test(value)) continue;

          const step = Number(value);
          if (SCALE_STEPS.has(step)) continue;

          const onGrid = Number.isInteger(step);
          if (onGrid && allowGridMultiples) continue;

          context.report({
            node,
            messageId: onGrid ? "offScale" : "offGrid",
            data: { token, px: String(step * PX_PER_STEP) },
          });
        }
      },
    };
  },
};

export default rule;
