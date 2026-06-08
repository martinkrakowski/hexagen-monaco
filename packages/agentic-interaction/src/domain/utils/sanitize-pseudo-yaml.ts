/**
 * Lightweight, dependency-free recovery for "pseudo-YAML" specs that embed
 * TypeScript syntax the YAML parser can't handle.
 *
 * This module intentionally has NO imports so it can be pulled into a client
 * bundle (it is reachable from the `"use client"` import-spec page via
 * `detectInputMode`) without dragging in the staged-generation pipeline. Keep it
 * free of heavy / server-only dependencies.
 */

function doubleQuoteScalar(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function singleQuoteScalar(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Best-effort recovery for "pseudo-YAML" specs that embed TypeScript syntax the
 * YAML parser can't handle — most often method signatures under `methods:`
 * (`- execute(brief: CampaignBrief): Promise<Result>`) and quoted union types
 * (`level: "info" | "warn" | "error"`). Both have extra/unquoted colons that make
 * js-yaml throw, which otherwise forces the whole spec down the lossy LLM
 * conversion path even though it is otherwise well-structured. This quotes those
 * scalar values so the spec parses and the deterministic structured-config path
 * (incl. `normalizeDialect`) can run.
 *
 * Applied ONLY as a fallback after a strict parse fails (see
 * `parseStructuredConfig`), so valid YAML is never touched. It is line-based and
 * intentionally conservative; if it cannot make the spec parse, callers fall
 * back to their prior behaviour. Lines inside block scalars (`>` / `|`) can in
 * principle match, but such content never causes the parse failure being
 * recovered from, so the impact is limited to otherwise-unparseable specs.
 */
export function sanitizePseudoYaml(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      // Block-sequence item that looks like a method signature:
      // `- name(args): ReturnType` → quote the whole item.
      const seq = line.match(/^(\s*-\s+)(.+)$/);
      if (seq) {
        const value = seq[2].trimEnd();
        if (
          !/^["']/.test(value) &&
          value.includes("(") &&
          value.includes(")") &&
          value.includes(":")
        ) {
          return `${seq[1]}${doubleQuoteScalar(value)}`;
        }
        return line;
      }
      // Mapping value that is a quoted union: `key: "a" | "b" | "c"`.
      const map = line.match(/^(\s*[\w-]+:\s+)("[^"]*"\s*\|.*\S)\s*$/);
      if (map) {
        return `${map[1]}${singleQuoteScalar(map[2])}`;
      }
      return line;
    })
    .join("\n");
}
