# Engine Cleanup & Wizard Follow-ups

**Implementation branches:** shipped across `feature/rollback-gated-conflicts`, `feature/template-questions-step`, and `feature/companion-cta` (per the shipped map below) — the single `feature/engine-cleanup-and-wizard-followups` branch this doc originally proposed was never used; the work was split one branch per item.
**Status:** Shipped — all three items merged to `main` (verified 2026-06-01).

> **Shipped map:**
>
> - **Item 1 (rollback gated conflicts):** `feature/rollback-gated-conflicts`. `ManifestConflict` / `isConflictActive` / `conflictTarget` removed; `conflicts: string[]` validated via `validatedStringArray`; `resolveDependencies` has no `answers` param; `CatalogConflict` / `unconditionalConflicts` gone from `apps/web`. Pattern-of-record note ("split the template — see supabase / supabase-auth") lives in the engine source and `engine-gated-outputs.md`.
> - **Item 2 (per-template questions step):** `feature/template-questions-step`. `TemplateQuestionsStep.tsx` in the wizard route; `auto` questions filtered from rendering; answers persist into `ProjectConfig.addOnsAnswers` via `react-hook-form` (no parallel context); Summary annotates derived answers with `(derived from …)`; `template-questions.generated.ts` parity enforced by CI (`check:template-questions`).
> - **Item 3 (companion CTA):** `feature/companion-cta`. `CompanionBanner.tsx` (`@hexagen/ui` primitives, per-row dismiss, `[+N more]` collapse); `CatalogEntry.companions?: string[]` declared on supabase→supabase-auth and three further pairs; routes adds through the existing conflict dialog.

**Relates to:** [auth-stack-restructure.md](./auth-stack-restructure.md), [shared-types-and-derived-answers.md](./shared-types-and-derived-answers.md), [engine-gated-outputs.md](./engine-gated-outputs.md), [05-supabase.md](./05-supabase.md), [15-supabase-auth.md](./15-supabase-auth.md)

---

## Scope

Three follow-ups surfaced during PRs #108 and #109 reviews, batched together because they're small and complete the auth-ecosystem cleanup. Two touch the wizard, one is engine-internal; all are non-breaking for installed projects.

1. **Roll back PR #108's dormant gated-conflicts schema.** The feature ships an evaluator path that the only caller never exercises with answers, and PR #109 proved the template-split pattern (the supabase / supabase-auth model) is the right tool for the conditional-coupling problem the schema tried to solve.
2. **Per-template questions step in the wizard.** Today the wizard ends at Summary; per-template questions are collected by the CLI later. When (and only when) the wizard takes over end-to-end installation, it needs a UI for collecting answers. Land the step + the `auto`-question filter so the auto/derivedFrom pattern works through the wizard the same way it works in the CLI.
3. **"Layer auth?" companion CTA.** A small discoverability nudge: when the user picks Supabase, surface that Supabase Auth exists as a one-click companion. Generalize to any template-pair via a catalog `companions: string[]` field.

---

## Item 1 — Roll back gated conflicts

### Why

PR #108 added `ManifestConflict = string | { id; when: OutputCondition }` so Supabase could conflict with auth providers only when `features ⊇ {auth}`. The evaluator (`isConflictActive`) and the resolver branch were written and tested.

`add-template.use-case.ts:49` is the only caller of `resolveDependencies`:

```ts
const ordered = resolveDependencies(templateIds, manifestMap);
```

No `answers` argument is passed (answers are collected later, inside the install loop at line 63). The engine's documented conservative default — `matchesCondition` returns `false` for missing answers — means every gated entry evaluates inactive. PR #108's eight gated conflicts on the old Supabase manifest never fired.

PR #109 then split Supabase into storage-only `supabase` (zero conflicts) and `supabase-auth` (unconditional plain-string conflicts with all eight other auth-related templates). After that PR, **no template in the registry uses the gated-conflict shape.** The schema exists for zero current consumers.

The team has now learned (across PRs #108 and #109) that:

- Static dep graphs make `resolveDependencies` work correctly under the current single-pass use case.
- Template splits express "this dep applies in some configurations" cleanly and don't require schema gymnastics.
- A two-phase resolver (collect-then-resolve-then-collect-more) cascades into recursive question prompts and is significant complexity for a feature with zero proven demand.

So: keep the established pattern (template split), delete the speculative schema feature.

### Changes

| File                                                                      | Change                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/template-engine/src/domain/question.ts`                         | Remove `ManifestConflict` type union.                                                                                                                                                                                               |
| `packages/template-engine/src/domain/template-manifest.ts`                | Change `conflicts: ManifestConflict[]` → `conflicts: string[]`. Drop `validatedConflicts` (use the existing `validatedStringArray("conflicts")` helper instead — symmetric with `requires`).                                        |
| `packages/template-engine/src/domain/output-gating.ts`                    | Drop `conflictTarget` and `isConflictActive`. Keep `matchesCondition` (gated outputs still use it).                                                                                                                                 |
| `packages/template-engine/src/domain/index.ts`                            | Drop the corresponding re-exports.                                                                                                                                                                                                  |
| `packages/template-engine/src/application/resolve-dependencies.ts`        | Drop the optional `answers?: Map<string, AnswerMap>` parameter. Simplify the conflict loop back to a plain `for (const conflictId of manifest.conflicts) { if (needed.has(conflictId)) throw new ConflictError(id, conflictId); }`. |
| `apps/web/features/project-wizard/steps/add-ons-step/template-catalog.ts` | Remove `CatalogConflict` union type — back to `conflicts: string[]`. Drop the `unconditionalConflicts` helper introduced for the gated case; `findConflicts` simplifies. (No catalog entries use the gated form post-#109.)         |
| `packages/template-engine/__tests__/domain/template-manifest.test.ts`     | Drop the four gated-conflict validator tests added in PR #108.                                                                                                                                                                      |
| `packages/template-engine/__tests__/domain/resolve-dependencies.test.ts`  | Drop the five gated-conflict resolver tests added in PR #108.                                                                                                                                                                       |

Migration risk for installed projects: **none.** Conflict declarations as plain strings remain valid; no manifest in the registry uses the gated form. CI guard: the `validatedStringArray("conflicts")` call will throw on any future manifest that tries to use the object form, which is the desired behaviour after rollback.

### Net deletion

~120 LOC across `question.ts`, `template-manifest.ts`, `output-gating.ts`, `resolve-dependencies.ts`, plus 9 tests removed. The supabase manifest itself shed its gated-conflict array in PR #109; only the engine plumbing remains.

### Documentation

Add a short paragraph to `engine-gated-outputs.md` (or the engine README): "Gated outputs are supported; gated requires and gated conflicts are not. For dependencies that apply only in some configurations, split the template — see `supabase` / `supabase-auth` as the canonical example." Replace any prose in the planning docs that references gated conflicts.

---

## Item 2 — Per-template questions step

### When this matters

The wizard currently routes: WorkspaceGovernance → BoundedContext → PeerMapping → PortConfiguration → AddOns → Review → Summary → Generate. The "Generate" action today produces a scaffolded project; per-template question answers are collected later by the CLI's `hexagen add` run.

**This plan ships the wizard step only when the wizard is supposed to run install end-to-end.** If that's not on the near-term roadmap, defer this item — the engine already has the `auto + derivedFrom` mechanism wired in the CLI, and the wizard catalog has all the metadata it needs for selection. The questions step is the bridge that doesn't yet have either side requiring it.

### Catalog source-of-truth

The wizard's `template-catalog.ts` carries display metadata (description, requires, conflicts, includes list, category). It does **not** carry `questions`. Two options:

A. **Extend the catalog** — add `questions: TemplateQuestion[]` to every `CatalogEntry`. Hand-maintained alongside the manifest. Drift risk: low if a CI check asserts each catalog entry's questions match its manifest's.

B. **Generate the catalog from manifests** — write a build script `scripts/build-catalog.ts` that reads every `packages/template-engine/templates/<id>/manifest.json` and emits a `template-catalog.generated.ts` consumed by the wizard. Single source of truth in the manifest; catalog becomes derived.

Recommend **B**. The manifest is the contract; the catalog is the view. Two reasons:

- Drift between manifest and catalog has bitten this codebase before (PR #109's catalog Group A entries were missing `shared-types` after the manifests had been updated — a finding from the most recent review). A generator eliminates the class of issue.
- The `questions` array carries enough nuance (option lists, defaults, validation patterns) that hand-maintaining a duplicate is fragile.

Catalog entries still have hand-written `description`, `details.overview`, `details.includes` (marketing copy). A small JSON sidecar in each template directory (`presentation.json`) holds those; the generator merges sidecar + manifest into the catalog. Or keep the existing in-code catalog and have the generator emit only `questions`.

Pick **the smaller change**: in-code catalog stays for display copy; the generator emits `template-questions.generated.ts` with one export — `Record<TemplateId, TemplateQuestion[]>` — which the questions step imports. Catalog and questions remain decoupled in source but co-located by template-id in code.

### Wizard step

New step `TemplateQuestionsStep.tsx`, slotted between AddOns and Review (or between AddOns and Summary if Review goes away):

```
TemplateQuestionsStep
├── For each selected template id (in dependency order):
│   ├── Section header with template name
│   └── For each question in TEMPLATE_QUESTIONS[id]:
│       ├── if q.type === "auto" → skip rendering (resolved at install time)
│       ├── if q.type === "boolean" → checkbox
│       ├── if q.type === "select" → radio group / dropdown
│       ├── if q.type === "multiselect" → checkbox group
│       └── if q.type === "text" → text input (with validation)
└── Validates `required: true` text questions on Next
```

Per-template answers are stored **in the existing `react-hook-form` `ProjectConfig`** that already orchestrates the wizard's state — not in a new React context. Today the wizard uses `useFormContext<ProjectConfig>()` across steps (`PeerContextMappingStep`, `SummaryStep`, etc.); introducing a parallel context for template answers would split state, fragment validation, and force the Summary step to merge two sources. Instead:

- Add a new field to the `ProjectConfig` schema in `apps/web/features/project-wizard/config.ts`: `addOnsAnswers: Record<TemplateId, AnswerMap>` (default `{}`).
- The new questions step reads/writes via `useFormContext<ProjectConfig>()` and `setValue("addOnsAnswers.<id>.<question>", value)`.
- The Summary step's `watch("addOnsAnswers")` replaces any cross-context plumbing.
- On Generate, the install request reads `addOnsAnswers` directly from the form payload and maps it onto the CLI use case's existing `overrideAnswers` parameter.

Validation rules (e.g. `required: true` text fields) are expressed as `react-hook-form` validators in the same place as the rest of the wizard's validation, keeping the per-step "Next" gating consistent.

### Summary step annotation

When the Summary step lists templates and their final answers, **auto**-typed questions are shown with `"(derived from <source>.<question>)"` next to their resolved value. Two reasons:

- Transparency: the user can audit where each answer originated before committing.
- Diagnostic: if the derivation chain is wrong (typo'd `derivedFrom`, missing source template), it's visible in the Summary instead of mysteriously off in the generated files.

### Test coverage

- `TemplateQuestionsStep.test.tsx` — given a selected set including a template with an `auto` question, asserts the auto question is not rendered.
- `TemplateQuestionsStep.test.tsx` — required text without an answer blocks Next.
- `SummaryStep.test.tsx` — auto answers are annotated with their `derivedFrom` source.
- `template-questions.generated.test.ts` — generator output matches manifests for every template (smoke test asserting parity).

### Scope estimate

~250 LOC for the step + ~50 LOC for Summary annotation + ~30 LOC for the `ProjectConfig` schema extension (`addOnsAnswers` field + default) + ~120 LOC for the generator + ~150 LOC tests. ~600 LOC + a build-script hook. One day of focused work. Smaller than v1 because we reuse `react-hook-form` instead of introducing a parallel React context.

---

## Item 3 — "Layer auth?" companion CTA

### Goal

When the user adds `supabase` to their selection, surface that `supabase-auth` exists as a companion they can add with one click. Generalize so future template pairs (e.g. `bullmq` and a hypothetical `bullmq-dashboard`) get the same affordance without per-tile code.

### Mechanism

Add a `companions: string[]` field to `CatalogEntry`. Template-catalog declares them statically:

```ts
{
  id: "supabase",
  ...
  companions: ["supabase-auth"],
}
```

The wizard's add-ons step renders a banner under the selected-templates panel when any selected template has unselected companions. The banner accepts a **list** of suggestions, not a single one, so multiple selected templates with companions stack cleanly instead of competing for one slot.

```
💡 Companion templates
   Supabase Auth — adds @supabase/ssr session middleware on top of Supabase.
   [+ Add Supabase Auth]    [Dismiss]
```

One click toggles the companion in. "Dismiss" hides that specific companion for the session (no persistence; if the user deselects and re-selects the parent, it reappears).

`findConflicts` runs on the proposed addition first — if the companion conflicts with an already-selected template (e.g. user has google-oauth and Supabase, then picks supabase-auth via the banner), the existing conflict dialog fires and the user resolves it the same way they would for any direct selection. No new conflict-handling code needed.

### Design-system compliance

`CompanionBanner.tsx` renders inside `AddOnsStep`, so it must follow `DESIGN.md`:

- **Primitives only**: import `Button` (and any other UI atoms) from `@hexagen/ui`. No raw `<button>` / custom buttons.
- **4px baseline grid** for spacing: `gap-2` (8px), `p-3` (12px) or `p-4` (16px). No off-grid arbitrary values.
- **Token-driven colour**:
  - Container surface: `bg-muted/30` (matches the existing selected-templates panel below; see `AddOnsStep.tsx:168`).
  - Body text: `text-foreground`; meta text: `text-muted-foreground`.
  - Icon accent: `text-primary` for the hint glyph; `text-muted-foreground/60` for the dismiss affordance.
  - Border (if any): `border border-border`.
- **Focus + disabled states** inherit from `@hexagen/ui` `Button`; no overrides.

### Multi-companion stacking

The banner takes `suggestions: CompanionSuggestion[]` and renders one row per suggestion in a vertical flex layout (`flex flex-col gap-2`). Two display modes based on count:

- **1–3 suggestions** — render all rows in full.
- **4+ suggestions** — render the first three; collapse the rest behind a `[+N more]` link that expands the list on click. The expanded list stays under the same banner container; no modal.

Each row is independently dismissable. The banner container itself only renders when at least one non-dismissed suggestion exists.

Session-scoped dismissal state lives in component-local `useState<Set<TemplateId>>` — no form-state pollution since dismissal is presentation, not configuration.

### What this is NOT

- Not a sub-feature of the parent tile. Companions are siblings in the catalog; the banner is a discovery affordance, not a coupling.
- Not auto-add. The user clicks; nothing is added silently.
- Not bidirectional. Supabase Auth doesn't "auto-suggest" Supabase because the engine already does that (Supabase is a static `requires` of Supabase Auth, auto-resolved at install).

### Scope estimate

- `CatalogEntry.companions?: string[]` — 1 line in the type.
- Set `companions: ["supabase-auth"]` on the supabase catalog entry — 1 line.
- `CompanionBanner.tsx` component (list-rendering, `@hexagen/ui` Button, 4px grid spacing, token-driven colour, per-row dismissal, `[+N more]` collapse for 4+) — ~110 LOC.
- Wire into `AddOnsStep` — ~20 LOC.
- Tests: banner appears for any unselected companion; one-click adds; per-row dismiss hides only that row; banner hides entirely when last row dismissed; conflict dialog fires on add when companion conflicts with existing selection; multi-companion stacking (3 visible + `[+N more]`) — ~120 LOC.

~250 LOC total. Half a day.

---

## Sequencing

Item 1 is independent and can ship alone. Items 2 and 3 both touch the wizard but are independent of each other; either could ship first.

Recommended order:

1. **Item 1 first** as its own small PR. It's a pure deletion and removes the temptation to use a feature that doesn't work, before anyone else touches conflicts.
2. **Item 3 next** as a small wizard PR. It's a focused affordance with clear acceptance criteria; doesn't require the new questions step.
3. **Item 2 last and conditionally** — only when the wizard is actually expected to run installs end-to-end. Until then, the questions live in the CLI prompt loop where they already work.

If items 2 and 3 do land together, they fit one PR since they share the wizard context. Item 1 should stay separate to keep the engine cleanup auditable.

---

## Out of scope

- **Refactoring `add-template.use-case.ts` to two-phase collect-then-resolve.** Rejected in favour of Item 1's rollback; tracked here for completeness so reviewers know it was considered.
- **Catalog generator that subsumes display copy.** Item 2's questions generator stays narrowly scoped — descriptions and includes lists remain hand-authored. Generating those is a separate, larger discussion.
- **Persistent dismissal of companion banners.** Item 3's "Dismiss" is session-scoped; persisting it would need wizard-state storage and is over-engineering for a discovery nudge.

---

## Trade-offs

### What this buys

- **Engine surface shrinks.** Removing dormant code is always a win; the next person reading `resolve-dependencies.ts` won't be confused by an unused branch.
- **Documented pattern of record.** "Conditional deps → template split" becomes the official answer, with `supabase` / `supabase-auth` as the canonical example. Future template authors don't reach for a gating primitive that doesn't fire.
- **Wizard reaches feature parity with the CLI** when Item 2 lands — per-template answers collected in the UI, including auto-derived ones presented transparently in Summary.
- **Discovery without coupling.** Companion CTAs surface related templates without forcing them into the parent's manifest or pretending they're sub-features.

### What this costs

- **PR #108's gated-conflicts work becomes a delete-only operation.** Not literal cost — that PR's main wins (the auth-stack restructure, the IMS refresh fix, the x-user-context guard, the NODE_ENV guard) all survive intact. Only the speculative schema feature is rolled back.
- **Item 2 ships a generator script** that becomes part of the build pipeline. One more thing to maintain. Mitigated by the smoke test (Item 2 acceptance criteria) that runs on every CI build.
- **Companion field is new catalog metadata.** Authors of future templates need to remember to set it for sibling pairs. Mitigated by a lint rule (or a comment in `CatalogEntry`'s definition) reminding authors to check whether a companion exists.

### Alternatives considered

- **For Item 1: refactor instead of rollback.** Cost-benefit was lopsided — significant resolver complexity for zero current consumers. The conditional-deps problem has a better answer (template split) that's already deployed in production.
- **For Item 2: build a manifest-aware "manifest sidecar" that owns display copy too.** Bigger blast radius, not needed for the questions-step deliverable. Punted to a separate discussion.
- **For Item 3: add the CTA as an inline checkbox on the Supabase tile.** Couples the tile to a specific companion; doesn't generalize. The banner pattern works for any template pair.

---

## Acceptance criteria

### Item 1

- `ManifestConflict` type does not appear in `packages/template-engine/src/domain/`.
- `resolveDependencies` signature has no `answers` parameter.
- The 9 dormant gated-conflict tests are removed; the remaining test suite passes (≥ 47 template-engine tests).
- `apps/web` typechecks; no remaining references to `CatalogConflict` / `unconditionalConflicts`.
- A line in the engine docs states: "for conditional dependencies, split the template (see supabase / supabase-auth)".

### Item 2

- New `TemplateQuestionsStep.tsx` in the wizard route.
- Auto-typed questions are not rendered in the prompt list (asserted by a unit test).
- Per-template answers persist into the existing `react-hook-form` `ProjectConfig.addOnsAnswers` field — no parallel React context.
- The new step reads/writes through `useFormContext<ProjectConfig>()` exactly like the other wizard steps; `Summary` step uses `watch("addOnsAnswers")`.
- Summary step annotates auto-derived answers with their source.
- `template-questions.generated.ts` is regenerated by a build script that CI runs and asserts parity with manifests.
- Wizard typechecks; new step's tests pass.

### Item 3

- `CatalogEntry.companions?: string[]` added to the type definition.
- Supabase catalog entry declares `companions: ["supabase-auth"]`.
- Banner renders a **list** of suggestions when any selected template has unselected companions; 4+ collapse behind `[+N more]`.
- Banner uses `@hexagen/ui` primitives only; spacing on the 4px grid (`gap-2`, `p-3`/`p-4`); colour via `bg-muted/30` / `text-muted-foreground` / `text-primary` tokens; focus + disabled states inherited from `Button`.
- Per-row dismissal stored in component-local `useState<Set<TemplateId>>` (presentation state, not form state); session-scoped, no persistence.
- One-click "Add" toggles the companion in; conflicts surface via the existing dialog.
- Component tests cover render, single-add, per-row dismiss, container hide when last row dismissed, conflict-on-add, and the 4+ stacking + expand.

---

## Estimated total

- Item 1: ~120 LOC + 9 tests **deleted** + ~10 LOC docs added. ~half a day.
- Item 2: ~600 LOC added + build-script hook. ~1 day. (Smaller than v1 because state lives in the existing `react-hook-form` `ProjectConfig`, not a new context.)
- Item 3: ~250 LOC added. ~half a day. (Slightly larger than v1 to support multi-companion stacking, `[+N more]` expand, and strict `@hexagen/ui` token compliance.)

If shipped together (engine cleanup + both wizard items): ~2 days, three PRs (one per item recommended) or one bundled PR.
