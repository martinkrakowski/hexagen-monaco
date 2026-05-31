# Code Review — Generator-Template Hardening (2026-05-30)

Two independent PRs, both branched off `main`, addressing issues found by
auditing every generator template against the **Context & Plane Mapping**
section of [`JOB-INDEX.md`](./JOB-INDEX.md), plus the follow-ups raised in
review.

| PR                                                                 | Branch                                              | Scope                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [#131](https://github.com/martinkrakowski/hexagen-monaco/pull/131) | `fix/auth-provider-user-dto-placement`              | Move OAuth provider user DTOs out of the domain layer (+ emit-shape tests)                       |
| [#132](https://github.com/martinkrakowski/hexagen-monaco/pull/132) | `fix/template-interpolation-and-manifest-hardening` | Interpolation `${…}` passthrough, `in` gate operator, operator/type validation, env-setup dedupe |

---

## PR #131 — Move OAuth provider user DTOs out of the domain layer

`refactor` + `test` · 2 commits · 16 files, +123/−12

- `1a0050c9` — relocate the DTOs.
- `583b7c4e` — emit-shape test coverage (resolves the review gap below).

### Why

The mapping classifies auth providers as **infrastructure adapters** that map
their wire format to the shared `UserContext` kernel. Three providers violated
this by emitting a provider-specific user **value object into
`src/domain/value-objects/`** — a raw OIDC/profile DTO (`{ sub, email, name, … }`)
that the domain layer should never know. The other six providers were already
correct (adobe-ims uses a domain _port_; the rest keep provider shapes out of
`src/domain/`).

### What changed (per provider × 3: google, github, entra)

- **Renamed** `files/src/domain/value-objects/<p>-user.ts` →
  `files/src/infrastructure/auth/<p>/<p>-user.ts` (git tracked as pure renames).
- **Import rewrite** in the 3 consumers (`<p>-auth.adapter.ts`,
  `user-profile-mapper.ts`, `session-store.ts`) from
  `../../../domain/value-objects/<p>-user` → `./<p>-user`.
- **`manifest.json`** output path updated. No domain outputs remain for these
  providers.

### Tests

`__tests__/templates/oauth-provider-emit-shape.test.ts` (new) — parameterized
over the three providers; each asserts the DTO is emitted under
`src/infrastructure/auth/<p>/`, is **absent** from `src/domain/value-objects/`,
and that the adapter imports `./<p>-user`. Locks the layer placement against
future refactoring slips.

### Verification

Manifests valid; renames tracked by git; emitted into temp projects via the new
test. Full suite **165/165**.

---

## PR #132 — Interpolation `${…}` passthrough, `in` gate, operator/type validation, env-setup dedupe

`fix` · 2 commits · 10 files, +269/−36

- `0313083a` — interpolation passthrough, `in` operator, env-setup dedupe, entra escape.
- `32ba7414` — gating operator/question-type validation.

### Change 1 — Interpolation ignores `${…}` (the algorithmic fix)

`packages/shared/src/types/interpolate.ts`. The token regex reserved any
`{ident}`, so JS/shell `${ident}` had its inner braces read as a placeholder —
emitting spurious "unresolved variable" warnings on every template literal, and
a latent footgun where `${someAnswerId}` would be silently replaced in emitted
code. Added a negative lookbehind:

```
/\$\{\{[\s\S]*?\}\}|\{\{|\}\}|(?<!\$)\{([A-Za-z_][A-Za-z0-9_.-]*)\}/
```

Now only a _bare_ `{var}` is a placeholder; `${…}` and `${{…}}` pass through.
Verified no template used `${answerId}`, so **emitted output is unchanged** —
this only removes warnings (dozens → 0) and the footgun.

### Change 2 — New `in: [...]` gating operator

Lets one output gate on "answer is one of N" instead of duplicating the entry.

- `src/domain/question.ts` — `OutputCondition.in?: string[]`.
- `src/domain/output-gating.ts` — `matchesCondition` evaluates `in` (scalar membership).
- `src/domain/template-manifest.ts` — validation (non-empty string array, mutually exclusive with `equals`/`includes`).
- `templates/env-setup/manifest.json` — collapsed the two duplicated `load-env.ts` entries into one `in: ["dotenv","dotenv-expand"]`.

### Change 3 — Operator/question-type validation

`src/domain/template-manifest.ts`. `validatedOutputs` checked that `when.answer`
references a known question but not that the operator fits its **type** — a
mismatch silently never fires (e.g. `in` on a boolean answer is never a string,
so the file is never emitted). `validateManifest` now passes question types, and
the validator rejects:

- `equals`/`in` on a multiselect answer (only `includes`);
- `includes`/`in`, or a string `equals`, on a boolean answer (only `equals: true|false`);
- `includes`, or a boolean `equals`, on a select/text answer (`equals` string, or `in`).

`auto` answers are type-erased at authoring time and skipped. Audited all 23
templates first — no existing manifest trips the new rules.

### Change 4 — One real dead placeholder

`templates/microsoft-entra/.../entra-auth.adapter.ts` — escaped a bare
`{tenantId}` in a doc comment (Microsoft's URL placeholder) to `{{tenantId}}`.
This was the single genuine warning the cleaned-up channel surfaced.

### Tests & docs

- `__tests__/interpolation.test.ts` (new) — placeholder vs `${…}`/`${{…}}`/`{{ }}`, plus the footgun.
- `__tests__/domain/output-gating.test.ts` + `template-manifest.test.ts` — `in` evaluation/validation and operator/type-mismatch rejection.
- `ADR-0039` — amended from "GitHub Actions `${{…}}`" to the general "all `$`-prefixed expressions" rule.

### Verification

Full suite **169/169**, `yarn typecheck` exit 0, **0 unresolved-var warnings**
across all templates, all 23 manifests validate clean, `env-setup` `in`-gate
confirmed.

---

## Cross-PR notes

- **One overlapping file**: `microsoft-entra/.../entra-auth.adapter.ts` is
  touched by both PRs — #131 changes the _import line_, #132 escapes the _doc
  comment_ (different lines, auto-mergeable). Merge order doesn't matter.
- **Scope split rationale**: #131 is a file relocation + its tests (context/plane
  conformance); #132 is engine behavior + schema. Kept separate so each is
  independently reviewable/revertable.
- **Audit coverage (clean)**: across all 23 templates — no missing-source
  outputs, no orphan files, no bad `requires`/`conflicts`, no unknown
  gate-answer references, no operator/type mismatches. Remaining `src/domain/`
  outputs are legitimate (ports for llm-adapter/langgraph/adobe-ims;
  `UserContext` for shared-types; the error hierarchy for error-handling).

## Accepted debt (not fixed)

- **`}}` inside a `${{ … }}` expression** (e.g. `${{ fromJSON('{"a":{}}') }}`)
  terminates the non-greedy match early. Documented as Known Debt in ADR-0039;
  no template uses inline-JSON GHA expressions, and a correct fix needs a
  balanced-brace parser rather than a regex. Left as-is.
