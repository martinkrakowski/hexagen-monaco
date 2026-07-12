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
      // `- name(args): ReturnType` → quote the whole item. The token that breaks
      // YAML is the colon INSIDE the argument list (`name(arg: Type): Ret`), so
      // quote only when the parenthesised args themselves contain a colon. That
      // leaves a legitimate mapping item whose key merely ends in `()`
      // (`- validate(input): true`) untouched instead of collapsing it to a
      // scalar (#260 review).
      const seq = line.match(/^(\s*-\s+)(.+)$/);
      if (seq) {
        const value = seq[2].trimEnd();
        const args = value.match(/\(([^)]*)\)/);
        if (!/^["']/.test(value) && args !== null && args[1].includes(":")) {
          return `${seq[1]}${doubleQuoteScalar(value)}`;
        }
        return line;
      }
      // Mapping value that is a quoted union: `key: "a" | "b" | "c"` (or the
      // single-quoted form `key: 'a' | 'b' | 'c'`). Either breaks js-yaml the same
      // way — content trails a closing quote on the line — so both are recovered.
      const map = line.match(
        /^(\s*[\w-]+:\s+)((?:"[^"]*"|'[^']*')\s*\|.*\S)\s*$/,
      );
      if (map) {
        return `${map[1]}${singleQuoteScalar(map[2])}`;
      }
      // Mapping value that is a TypeScript signature:
      // `signature: (order: Order) => Promise<void>` — the colon inside the
      // parenthesised args makes js-yaml throw (same failure as the sequence
      // form above, just as a mapping value). Quote the whole value. Gated on
      // args-with-a-colon or an arrow so prose values are never touched; lines
      // with an inline comment are skipped (the comment must stay a comment).
      const sig = line.match(/^(\s*[\w-]+:\s+)([^"'#\s].*\S)\s*$/);
      if (sig && !sig[2].includes(" #")) {
        const value = sig[2];
        const args = value.match(/\(([^)]*)\)/);
        if ((args !== null && args[1].includes(":")) || value.includes("=>")) {
          return `${sig[1]}${doubleQuoteScalar(value)}`;
        }
      }
      return line;
    })
    .join("\n");
}
