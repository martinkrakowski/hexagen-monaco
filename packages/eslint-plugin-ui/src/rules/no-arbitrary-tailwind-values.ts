import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

type MessageIds = "arbitraryValue";

const EXCEPTION_PATTERNS = [
  "active:scale-[0.98]", // Documented press feedback exception
];

/**
 * Detects arbitrary Tailwind values in className strings.
 * Arbitrary values match patterns like: w-[347px], text-[13px], px-[18px]
 * Exception: active:scale-[0.98] is permitted per DESIGN.md §4.7
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
        'Arbitrary Tailwind value "{{value}}" violates token system. Use semantic token or spacing scale instead. See DESIGN.md §4.6.',
    },
    schema: [],
  },
  create(context) {
    const ARBITRARY_PATTERN = /(\w+)-\[[\w-.%#()]+\]/g;

    return {
      Literal(node: TSESTree.Literal) {
        // Only check string literals
        if (typeof node.value !== "string") return;

        const classString = node.value;

        // Only check strings that look like className values
        if (!classString.match(/^[\w\s\-[\]/:.\-#]+$/)) return;

        // Find all arbitrary value matches
        const matches = [...classString.matchAll(ARBITRARY_PATTERN)];

        matches.forEach((match) => {
          const fullValue = match[0];

          // Skip documented exceptions
          if (EXCEPTION_PATTERNS.includes(fullValue)) return;

          context.report({
            node,
            messageId: "arbitraryValue",
            data: { value: fullValue },
          });
        });
      },
    };
  },
};

export default rule;
