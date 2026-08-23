import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { safeTemplateTokens } from "./class-string-tokens.js";

type MessageIds = "arbitraryValue";

/**
 * Exact class tokens permitted by name, per the exception table in
 * DESIGN.md §4.8. Entries here are matched against the WHOLE token
 * (variants included), so `active:scale-[0.98]` is exempt while
 * `hover:scale-[0.98]` is not.
 */
const EXCEPTION_PATTERNS = [
  "active:scale-[0.98]", // Documented press feedback exception
];

/**
 * A single Tailwind class token carrying an arbitrary value: an optional
 * stack of variants (`hover:`, `sm:`, `dark:`) followed by a utility,
 * followed by `-[…]`.
 *
 * Anchored to the WHOLE token — the visitor splits the className on
 * whitespace before testing — which is what keeps two unrelated syntaxes out:
 *   - arbitrary VARIANTS (`data-[state=open]:bg-accent`, `[&>svg]:size-4`),
 *     where the bracket is a selector, not a value; and
 *   - brackets embedded mid-word in prose or paths.
 *
 * The value group is `[^\]\s]+` — deliberately permissive. The previous
 * implementation guarded the visitor with a narrower "looks like a className"
 * character allowlist (`/^[\w\s\-[\]/:.\-#]+$/`) that omitted `%`, `(` and
 * `)`, so an ENTIRE className string was discarded before this pattern ever
 * ran: `w-[85%]` and `w-[calc(100%-2rem)]` were silently unenforced, as was
 * every other class sharing a string with them. Any allowlist narrower than
 * what this pattern accepts reintroduces that class of bug, so there is no
 * longer a whole-string pre-filter — matching is per token, and a token the
 * rule cannot classify is simply not a match.
 */
/*
 * The `!?` groups carry Tailwind's IMPORTANT modifier, in both spellings:
 * v3 puts it before the utility (`!w-[85%]`, `hover:!w-[85%]`), v4 puts it
 * after the token (`w-[85%]!`). Without them `[\w-]+` rejects the `!` and the
 * token is not a match at all -- so marking a magic number important was
 * enough to walk past the rule entirely.
 */
const ARBITRARY_TOKEN = /^((?:[\w-]+:)*!?[\w-]+)-\[([^\]\s]+)\]!?$/;

/** Strip the important modifier for comparisons that are about the VALUE. */
const IMPORTANT = /!/g;

/**
 * A reference to a CSS custom property, e.g. `var(--card-width-md)`.
 *
 * DESIGN.md §4.8 forbids arbitrary values to keep MAGIC NUMBERS out of the
 * markup; a `var(--token)` reference is the opposite of a magic number — it
 * is the only way to consume a §4.6 component token that has no Tailwind
 * utility of its own, and the value itself still lives in `globals.css`.
 * Documented as a category exception in DESIGN.md §4.8.
 *
 * Strict by design: only a bare custom-property reference qualifies.
 * `calc(...)`, `var(--x, 12px)` fallbacks, and any literal (`85%`, `347px`,
 * `calc(100%-28px)`) remain violations — those smuggle a magic number back in.
 */
const TOKEN_REFERENCE = /^var\(--[\w-]+\)$/;

/**
 * Utilities whose bracket names CSS PROPERTIES rather than supplying a value
 * (`transition-[box-shadow,border-color]`). No magic number can be expressed
 * this way — `transition-[300ms]` fails PROPERTY_NAME_LIST and is still
 * reported. Documented as a category exception in DESIGN.md §4.8.
 */
const PROPERTY_LIST_UTILITIES = new Set(["transition", "will-change"]);
const PROPERTY_NAME_LIST = /^[a-z-]+(?:,[a-z-]+)*$/;

const VARIANT_PREFIX = /^(?:[\w-]+:)*/;

/**
 * Detects arbitrary Tailwind values in className strings.
 * Arbitrary values match patterns like: w-[347px], text-[13px], px-[18px]
 * Exceptions are enumerated in DESIGN.md §4.8.
 *
 * Scope note: only string `Literal` nodes are inspected. Class names built
 * inside template literals (`` `… sm:w-[400px] …` ``) are TemplateElement
 * nodes and are NOT seen by this rule — a known, separate gap.
 */
const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow arbitrary Tailwind values outside documented exceptions (Design Token System)",
    },
    messages: {
      arbitraryValue:
        'Arbitrary Tailwind value "{{value}}" violates token system. Use a semantic token, the spacing scale, or a var(--token) reference to a token defined in globals.css. See DESIGN.md §4.8.',
    },
    schema: [],
  },
  create(context) {
    return {
      // Classes built with backticks were invisible to this rule until now.
      // Boundary fragments adjacent to an interpolation are dropped by
      // safeTemplateTokens rather than guessed at -- see that module.
      TemplateElement(node: TSESTree.TemplateElement) {
        const parent = node.parent as TSESTree.TemplateLiteral | undefined;
        if (parent === undefined || parent.type !== "TemplateLiteral") return;
        classify(safeTemplateTokens(node, parent), node);
      },

      Literal(node: TSESTree.Literal) {
        // Only check string literals
        if (typeof node.value !== "string") return;
        classify(node.value.split(/\s+/), node);
      },
    };

    function classify(tokens: readonly string[], node: TSESTree.Node): void {
      // A className is a token stream: classify each token on its own, so
      // one unrecognised token can never suppress the rest of the string.
      {
        for (const token of tokens) {
          const match = ARBITRARY_TOKEN.exec(token);
          if (match === null) continue;

          const [fullValue, variantsAndUtility, value] = match;

          // Skip documented exceptions. Compared with the important
          // modifier stripped: `active:!scale-[0.98]` is the same documented
          // value as `active:scale-[0.98]`, and exempting one but not the
          // other would be an accident of spelling.
          if (EXCEPTION_PATTERNS.includes(fullValue.replace(IMPORTANT, "")))
            continue;

          // Skip design-token references (DESIGN.md §4.8 category exception)
          if (TOKEN_REFERENCE.test(value)) continue;

          // Skip property-name lists (DESIGN.md §4.8 category exception)
          const utility = variantsAndUtility
            .replace(VARIANT_PREFIX, "")
            .replace(IMPORTANT, "");
          if (
            PROPERTY_LIST_UTILITIES.has(utility) &&
            PROPERTY_NAME_LIST.test(value)
          ) {
            continue;
          }

          context.report({
            node,
            messageId: "arbitraryValue",
            data: { value: fullValue },
          });
        }
      }
    }
  },
};

export default rule;
