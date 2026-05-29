# Engine Enhancement: Gated Outputs (Conditional File Emission)

**Branch:** `feature/template-engine-gated-outputs`
**Status:** Proposed (design sketch — not yet implemented)
**Relates to:** [00-template-system-design.md](./00-template-system-design.md), [05-supabase.md](./05-supabase.md)

---

## Problem

The template engine performs flat `{variable}` interpolation only (see
`packages/shared/src/types/interpolate.ts`). It has **no way to include or
exclude a file based on an answer** — every entry in a manifest's `outputs`
is either always written or never written.

This breaks any template whose questions imply optional output:

- **Supabase (05):** `orm` (Drizzle) and `realtime_example` are opt-in and
  default **off**, but the engine can't conditionally emit their files.
  Shipping them always contradicts their own defaults.
- **Better Auth / NextAuth (04):** `providers`, `database` answers can't drive
  conditional code, so reviewers flagged "the answer is ignored" and
  "default conflicts with emitted files."

The recurring workaround — always emit everything, then ask the user to prune,
or drop the question entirely — produces misleading prompts and incoherent
scaffolds.

## Goal

Let a manifest gate individual `outputs` on an answer, **deterministically**.
No LLM, no change to the existing hash/conflict model, fully reproducible, and
backward-compatible with every current manifest.

> Note: an LLM-driven alternative (route file selection through the AI
> governance panel) was considered and rejected for the _emission_ path —
> it adds non-determinism, latency, and a trust problem to a curated,
> hash-verified scaffold. The governance LLM's role stays advisory
> (validate the selection, flag risky combos), layered _above_ emission.

---

## Design

An `outputs` entry may remain a plain string (always emitted, as today) **or**
become an object carrying a `when` condition. If the condition evaluates false,
the file is skipped — never read, never written, never recorded.

### Types — `packages/template-engine/src/domain/question.ts`

```ts
export interface OutputCondition {
  answer: string; // question id to test
  equals?: string | boolean; // exact match (boolean toggles, select)
  includes?: string; // multiselect contains this value
}

// Plain string = always emitted (back-compat). Object = conditional.
export type ManifestOutput = string | { path: string; when: OutputCondition };
```

### Pure evaluator — new `packages/template-engine/src/domain/output-gating.ts`

```ts
import type { AnswerMap } from "./question.js";
import type { ManifestOutput } from "./question.js";

export function outputPath(o: ManifestOutput): string {
  return typeof o === "string" ? o : o.path;
}

export function isOutputEnabled(
  o: ManifestOutput,
  answers: AnswerMap,
): boolean {
  if (typeof o === "string") return true;
  const v = answers[o.when.answer];
  const { equals, includes } = o.when;
  if (includes !== undefined) return Array.isArray(v) && v.includes(includes);
  if (equals !== undefined) return v === equals;
  // bare { answer }: truthy — boolean true, non-empty array, non-empty string
  return (
    v === true ||
    (Array.isArray(v) && v.length > 0) ||
    (typeof v === "string" && v !== "")
  );
}
```

Pure and isolated — slots into the existing domain test suite.

---

## Integration points

### 1. `domain/template-manifest.ts`

- Interface (line 18): `outputs: ManifestOutput[]`.
- `validateManifest` (line 49): accept a string **or**
  `{ path: string, when: { answer: string, equals?, includes? } }`; throw on
  malformed objects (mirror the existing `validatedQuestions` style).

### 2. `infrastructure/file-emitter.adapter.ts` (loop at line 42)

`answers` is already in scope (param at line 33). Gate at the top of the loop:

```ts
for (const out of manifest.outputs) {
  if (!isOutputEnabled(out, answers)) continue; // gated off — skip cleanly
  const outputRelPath = outputPath(out);
  // …unchanged: escape check, interpolate(raw, answers), hash, conflict, write…
}
```

`generatedFiles` still keys on the rel-path string, so config records and
conflict detection are unchanged.

### 3. `application/use-cases/validate-templates.use-case.ts` (loops at lines 59, 78) — the subtle bit

Validation flags any declared output missing from disk. Gated-off files
legitimately won't exist, so it must evaluate gating against the **recorded
answers** (`record.answers`, already persisted in `TemplateConfig`):

```ts
for (const out of manifest.outputs) {
  if (!isOutputEnabled(out, record.answers)) continue;
  const p = outputPath(out);
  // …existing fs.access check…
}
```

---

## Example (Supabase opt-in phases)

```jsonc
"outputs": [
  "src/infrastructure/supabase/client.ts",                       // always
  { "path": "src/infrastructure/supabase/realtime/subscribe.ts",
    "when": { "answer": "realtime_example", "equals": true } },
  { "path": "src/infrastructure/supabase/drizzle/client.ts",
    "when": { "answer": "orm", "equals": true } },
  { "path": "scripts/migrate.ts",
    "when": { "answer": "orm", "equals": true } }
]
```

Multiselect example (Better Auth providers, were it gated):

```jsonc
{
  "path": "src/lib/providers/github.ts",
  "when": { "answer": "providers", "includes": "github" },
}
```

Now `orm` / `realtime_example` / `providers` genuinely gate their files — no
contradiction, no "answer ignored."

---

## Backward compatibility

- Every existing manifest uses string `outputs` → unaffected.
- The object form is purely additive; `validatedStringArray` is replaced with a
  validator that accepts both shapes.

## Testing

- New domain test for `isOutputEnabled`: boolean true/false, select `equals`,
  multiselect `includes`, bare-`answer` truthiness, and missing-answer → false.
- Extend `__tests__/infrastructure/file-emitter.test.ts` with a gated-off case
  asserting the file is **not** written and **not** in `generatedFiles`.
- Extend the validate-templates test so a gated-off output is not reported
  missing when its answer is absent/false.

## Scope

Small and contained: domain types + one pure helper + ~3-line changes in the
emitter and validator, plus tests. Per-template adoption is opt-in (only
manifests that need gating change).

## Follow-ups enabled

- Supabase (05): emit Drizzle (Phase 6) and Realtime (Phase 7) only when their
  toggles are on — completes the doc without the default/emitted contradiction.
- Retro-fit 04 templates (better-auth `database`/`providers`, nextauth
  `providers`) to gate provider/adapter files instead of reflecting answers in
  comments.

## Open questions

- Compound conditions (AND/OR of multiple answers)? Deferred — single-condition
  covers all current needs; revisit if a template needs `A && B`.
- Should the wizard catalog surface gating so the UI can preview which files a
  given answer set produces? Out of scope for the engine change.
