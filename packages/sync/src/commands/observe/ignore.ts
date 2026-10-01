import { globToRegexSource } from "./glob.js";

/**
 * Ordered rules from a gitignore-style file; the last matching rule wins.
 * Also used for `.gitattributes` patterns (same pattern syntax), where a
 * negated rule stands for "attribute unset".
 */
export interface IgnoreRule {
  readonly negated: boolean;
  readonly dirOnly: boolean;
  readonly regex: RegExp;
  /** The pattern as written, for literal-path extraction. */
  readonly pattern: string;
  /** True when the pattern is anchored (leading or inner `/`). */
  readonly anchored: boolean;
}

export function parseIgnoreLine(
  raw: string,
  negatedByCaller = false,
): IgnoreRule | null {
  let line = raw.replace(/\r$/, "");
  // Trailing unescaped spaces are dropped.
  line = line.replace(/(?<!\\)\s+$/, "");
  if (line === "" || line.startsWith("#")) return null;
  let negated = negatedByCaller;
  if (line.startsWith("!")) {
    negated = !negated;
    line = line.slice(1);
  }
  if (line.startsWith("\\#") || line.startsWith("\\!")) line = line.slice(1);
  let dirOnly = false;
  if (line.endsWith("/")) {
    dirOnly = true;
    line = line.slice(0, -1);
  }
  if (line === "") return null;
  const anchored = line.includes("/");
  const body = line.startsWith("/") ? line.slice(1) : line;
  const source = globToRegexSource(body, false);
  const regex = new RegExp(anchored ? `^${source}$` : `^(?:.*/)?${source}$`);
  return { negated, dirOnly, regex, pattern: line, anchored };
}

export function parseIgnoreFile(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const line of text.split("\n")) {
    const rule = parseIgnoreLine(line);
    if (rule) rules.push(rule);
  }
  return rules;
}

/**
 * The verdict of the last matching rule: true (ignored/set), false (negated),
 * or undefined when no rule matched.
 */
export function verdict(
  rules: readonly IgnoreRule[],
  relPath: string,
  isDir: boolean,
): boolean | undefined {
  let result: boolean | undefined;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(relPath)) result = !rule.negated;
  }
  return result;
}

/** A rule set that applies below `base` (repo-relative, "" for the root). */
export interface ScopedRules {
  readonly base: string;
  readonly rules: readonly IgnoreRule[];
}

/**
 * Evaluate nested gitignore files shallow to deep; the deepest decisive rule
 * wins, as in git. `relPath` is repo-relative.
 */
export function isIgnored(
  scopes: readonly ScopedRules[],
  relPath: string,
  isDir: boolean,
): boolean {
  let result = false;
  for (const scope of scopes) {
    if (scope.base !== "" && !relPath.startsWith(scope.base + "/")) continue;
    const local =
      scope.base === "" ? relPath : relPath.slice(scope.base.length + 1);
    const v = verdict(scope.rules, local, isDir);
    if (v !== undefined) result = v;
  }
  return result;
}
