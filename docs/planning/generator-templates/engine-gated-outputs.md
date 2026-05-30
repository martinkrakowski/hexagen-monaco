# Engine Enhancement: Gated Outputs (Conditional File Emission)

**Implementation branch:** `feature/template-engine-gated-outputs` (PR #101)
**Status:** Implemented
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
  answer: string; // question id to test (validated to exist)
  equals?: string | boolean; // exact match (boolean toggles, select)
  includes?: string; // multiselect contains this value
}
// `equals` and `includes` are mutually exclusive — validateManifest rejects both.

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
  answers: AnswerMap | null | undefined,
): boolean {
  if (typeof o === "string") return true;
  // Optional chaining tolerates a missing/corrupt answers map (no throw).
  const v = answers?.[o.when.answer];
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

- Interface: `outputs: ManifestOutput[]`.
- `validateManifest`: accept a string **or**
  `{ path: string, when: { answer: string, equals?, includes? } }`. The
  `validatedOutputs` validator **fails fast** (mirroring `validatedQuestions`):
  - **`when.answer` must match a declared `questions[].id`.** All answer keys
    originate from questions, so an unknown key means a typo/rename — which would
    otherwise silently disable the output _and_ hide it from validate. Reject it.
  - **`equals` and `includes` are mutually exclusive** — at most one may be set.
    Allowing both would make the gate ambiguous (the evaluator prefers `includes`).
  - **Type-check the values:** `equals` must be a `string | boolean`; `includes`
    must be a non-empty `string`. (The bare `{ answer }` truthiness mode stays.)

  Because `validatedOutputs` needs the question ids, `validateManifest` validates
  `questions` first, builds a `Set` of their ids, and passes it in.

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
answers** (`record.answers`, already persisted in `TemplateConfig`).

The config is loaded from disk **without** schema validation, so a missing or
corrupt `answers` must not crash validation. Coerce it to `{}`, and
`isOutputEnabled` additionally tolerates `null | undefined` via optional chaining:

```ts
const record = config.templates[id];
const answers =
  record && typeof record.answers === "object" && record.answers !== null
    ? record.answers
    : {};

for (const out of manifest.outputs) {
  if (!isOutputEnabled(out, answers)) continue;
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

- Domain test for `isOutputEnabled`: boolean true/false, select `equals`,
  multiselect `includes`, bare-`answer` truthiness, missing-answer → false, and
  a `null | undefined` answers map → no throw.
- `validateManifest` tests: a gated output referencing an **unknown answer** is
  rejected; setting **both `equals` and `includes`** is rejected; an `equals`
  that isn't `string | boolean` is rejected; an empty/`non-string` `includes`
  is rejected.
- `file-emitter.test.ts`: a gated-off output is **not** written and **not** in
  `generatedFiles`; a gated-on output is written.
- `validate-templates.test.ts`: a gated-off output is not reported missing when
  its answer is absent/false.

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

## What gating is NOT applied to

Gated outputs are the only schema feature in this family. **Gated requires and
gated conflicts are not supported.** PR #108 added a `ManifestConflict` union
that mirrored gated outputs for the `conflicts` array; it was rolled back
because the only caller of `resolveDependencies` did not (and could not, in a
single-pass install) supply per-template answers, so every gated conflict
evaluated inactive — dormant code with no enforcement path. A two-phase
collect-then-resolve refactor was considered and rejected as significant
complexity for zero current consumers.

The replacement pattern of record is **template splitting**: when a template
should require or conflict with another only under certain answers, split it
into a base and an addon. The canonical example is `supabase` / `supabase-auth`
(see [05-supabase.md](./05-supabase.md) and [15-supabase-auth.md](./15-supabase-auth.md)):
the base is storage-only and has zero auth conflicts; the addon statically
requires the base plus the shared-types/auth-mock foundation and conflicts
unconditionally with every other auth provider. The dependency graph stays
static, `resolveDependencies` runs once, and the install set is correct under
the existing use-case shape.
