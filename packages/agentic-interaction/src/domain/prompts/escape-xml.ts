/**
 * Escape XML-special characters in user-controlled text before interpolating
 * it into prompt markup, so spec-supplied values (context names, descriptions,
 * validation errors) cannot break out of their `<tag>` delimiters and inject
 * instructions.
 *
 * Canonical home for the implementation that previously existed as three
 * byte-identical private copies (generate-topology, generate-manifest,
 * convert-loose-spec) — those now import from here; output is unchanged
 * (proven by the prompt-snapshot tests passing without rebaseline).
 */
export function escapeXml(unsafe: string): string {
  return unsafe.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c] as string,
  );
}
