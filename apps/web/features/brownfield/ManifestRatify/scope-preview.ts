/**
 * S4 — the npm-scope normaliser, and a description of what it did.
 *
 * WHY A COPY LIVES HERE AT ALL. The canonical `sanitizeScope` is
 * `packages/sync/src/types/manifest/helpers.ts`, and this packet surfaced it on
 * `@hexagen/sync`'s public barrel precisely so nothing has to reimplement it.
 * `POST /api/projects/bootstrap` (BF-4.3) imports it from there, on the server,
 * and that is the copy that decides what lands in `manifest.yaml`.
 *
 * This screen cannot import it. `@hexagen/sync` publishes a single root subpath
 * whose `main` is a `splitting: false` tsup bundle, and its first ten lines are
 * `import path from 'path'`, `import fs from 'fs'`, `import { exec } from
 * 'child_process'`, `import { Project } from 'ts-morph'`. Pulling that into a
 * `"use client"` module drags Node builtins and the TypeScript compiler into the
 * browser bundle for one twelve-line pure function. That is the same trade
 * `GateInstall/gate-bundle-manifest.ts` already made against
 * `@hexagen/project-generation`, for the same reason, in this same slice.
 *
 * WHAT KEEPS THE COPY HONEST. `scope-preview.test.ts` imports `sanitizeScope`
 * from `@hexagen/sync` — the real one, through the real barrel — and asserts
 * this module against it over the canonical suite's own table plus generated
 * inputs. If the canonical implementation changes, that test goes red here
 * rather than a user discovering the divergence after the file is written. The
 * mirror is deliberate; it is not trusted by inspection.
 *
 * THE PROPER FIX, deliberately not attempted in this packet: move the helper to
 * `@hexagen/shared` (already imported by client components, no Node surface) and
 * have `@hexagen/sync` re-export it. That edits `packages/shared`, which is
 * outside this packet's fence.
 *
 * Pure data + pure functions: no React, no DOM, no `"use client"`.
 */

/**
 * What the canonical helper falls back to when the input sanitizes to nothing.
 * Chosen by `hexagen bootstrap`, not by this screen — hence a mirrored constant
 * rather than a UI-side default.
 */
export const SCOPE_FALLBACK = "generated-project";

/** npm's hard ceiling on a package-name segment. */
export const MAX_SCOPE_CHARS = 214;

/**
 * The rules the user's typing may run into, in the order they are applied.
 *
 * Named so the screen can say *which* rule bit, rather than showing a rewritten
 * string and leaving the user to diff it by eye.
 */
export type ScopeRuleId =
  | "trim"
  | "lowercase"
  | "strip-leading-at"
  | "replace-illegal"
  | "collapse-separators"
  | "truncate"
  | "trim-separators"
  | "fallback";

interface ScopeRule {
  readonly id: ScopeRuleId;
  /** Present tense, addressed to the user, no trailing period. */
  readonly explanation: string;
  readonly apply: (value: string) => string;
}

/**
 * The pipeline, transcribed one stage per rule from
 * `packages/sync/src/types/manifest/helpers.ts`.
 *
 * ORDER IS LOAD-BEARING and the canonical file says why: the separator trim runs
 * AFTER the 214-char truncation, because slicing at the limit can land on a `-`
 * and reintroduce a trailing separator. Reordering these two produces a value
 * npm rejects, and the parity test is what catches it.
 *
 * `sanitizeScope` below folds this list; `previewScope` folds the same list and
 * records where the value moved. One pipeline used two ways — a second
 * hand-written chain for the preview could disagree with the one that returns
 * the value, which is the failure mode this whole module exists to avoid.
 */
const SCOPE_RULES: readonly ScopeRule[] = [
  {
    id: "trim",
    explanation: "surrounding whitespace is dropped",
    apply: (value) => value.trim(),
  },
  {
    id: "lowercase",
    explanation: "npm scopes are lower-case",
    apply: (value) => value.toLowerCase(),
  },
  {
    id: "strip-leading-at",
    explanation: "the leading @ is added back by npm, not stored in the manifest",
    apply: (value) => value.replace(/^@+/, ""),
  },
  {
    id: "replace-illegal",
    explanation: "anything outside a-z, 0-9, dot, underscore and hyphen becomes a hyphen",
    apply: (value) => value.replace(/[^a-z0-9._-]/g, "-"),
  },
  {
    id: "collapse-separators",
    explanation: "runs of dots, underscores or hyphens collapse to a single hyphen",
    apply: (value) => value.replace(/[._-]{2,}/g, "-"),
  },
  {
    id: "truncate",
    explanation: `npm caps a name segment at ${MAX_SCOPE_CHARS} characters`,
    apply: (value) => value.slice(0, MAX_SCOPE_CHARS),
  },
  {
    id: "trim-separators",
    explanation: "a scope cannot start or end with a separator",
    apply: (value) => value.replace(/^[._-]+|[._-]+$/g, ""),
  },
  {
    id: "fallback",
    explanation: `nothing usable was left, so the scope falls back to ${SCOPE_FALLBACK}`,
    apply: (value) => (value.length > 0 ? value : SCOPE_FALLBACK),
  },
];

/**
 * Mirror of `sanitizeScope` from `@hexagen/sync`.
 *
 * Pinned to the canonical implementation by `scope-preview.test.ts`. Do not
 * "improve" it here — fix the canonical helper and let the parity test pull this
 * one along.
 */
export function sanitizeScope(raw: string): string {
  return SCOPE_RULES.reduce((value, rule) => rule.apply(value), raw);
}

/** One rule that actually changed the value the user typed. */
export interface AppliedScopeRule {
  readonly id: ScopeRuleId;
  readonly explanation: string;
}

export interface ScopePreview {
  /** Exactly what `hexagen bootstrap` will write as `scope:`. */
  readonly value: string;
  /** True when the entered text survives untouched — nothing to warn about. */
  readonly isUnchanged: boolean;
  /**
   * True when the input sanitized away to nothing and the fallback took over.
   * Distinct from `isUnchanged === false`: a user who typed `@Acme Corp!` got a
   * faithful `acme-corp`; a user who typed `@@@` got a name they never chose.
   */
  readonly usedFallback: boolean;
  /** The rules that moved the value, in application order. */
  readonly appliedRules: readonly AppliedScopeRule[];
}

/**
 * Run the pipeline and report what it did.
 *
 * This is the whole point of the screen: the manifest draft is what gets
 * WRITTEN, so the user has to see the rewrite before they accept it, not after
 * `manifest.yaml` lands in their repository.
 */
export function previewScope(raw: string): ScopePreview {
  const appliedRules: AppliedScopeRule[] = [];
  let value = raw;

  for (const rule of SCOPE_RULES) {
    const next = rule.apply(value);
    if (next !== value) {
      appliedRules.push({ id: rule.id, explanation: rule.explanation });
    }
    value = next;
  }

  return {
    value,
    isUnchanged: value === raw,
    usedFallback: appliedRules.some((rule) => rule.id === "fallback"),
    appliedRules,
  };
}
