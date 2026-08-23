import type { TSESTree } from "@typescript-eslint/utils";

/**
 * Tokens from a template-literal chunk that are SAFE to classify.
 *
 * Both Tailwind rules originally inspected string `Literal` nodes only, so a
 * class built with backticks was invisible to them. That is not a small gap:
 * `cn(\`... mt-0.5\`)` is ordinary in this codebase, and a rule that silently
 * skips it reports nothing rather than reporting wrongly — the harder failure
 * to notice.
 *
 * The reason it was left alone is real though, and this function is the answer
 * to it. A template's chunks are split BY the interpolations, so a chunk's
 * edges may hold half a token:
 *
 *     `mt-${size} gap-1.5`
 *      ^^^^                chunk 0 = "mt-"        <- a PREFIX, not a token
 *          ^^^^^^^^^^^     chunk 1 = " gap-1.5"   <- complete
 *
 * Classifying `mt-` would be nonsense, and classifying a trailing fragment as
 * if it were whole is how a rule invents violations that do not exist. So a
 * boundary token counts only when whitespace proves it is complete:
 *
 *   - a chunk that follows an expression drops its first token, unless the
 *     chunk starts with whitespace (which ends the interpolated token);
 *   - a chunk that precedes an expression drops its last token, unless the
 *     chunk ends with whitespace.
 *
 * The first and last chunks of the template are bounded by the backticks
 * rather than by an expression, so those outer edges are always complete.
 *
 * The cost is deliberate and stated: `` `mt-${a}` `` is never classified,
 * because nothing here can know what `a` holds. Under-reporting an
 * interpolated token is correct; guessing at it is not.
 */
export function safeTemplateTokens(
  node: TSESTree.TemplateElement,
  parent: TSESTree.TemplateLiteral,
): string[] {
  const raw = node.value.cooked ?? node.value.raw;
  if (raw === "") return [];

  const index = parent.quasis.indexOf(node);
  const followsExpression = index > 0;
  const precedesExpression = index < parent.quasis.length - 1;

  const tokens = raw.split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) return [];

  let start = 0;
  let end = tokens.length;

  if (followsExpression && !/^\s/.test(raw)) {
    // The chunk resumes mid-token: `${x}px-1.5` yields "px-1.5" here, but the
    // author wrote one token whose head is the expression.
    start += 1;
  }
  if (precedesExpression && !/\s$/.test(raw)) {
    // The chunk runs into the next expression: `mt-${x}` yields "mt-".
    end -= 1;
  }

  return start >= end ? [] : tokens.slice(start, end);
}
