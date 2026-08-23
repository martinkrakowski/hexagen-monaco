# PR-Agent review rubric — bot-facing

This file is for **PR-Agent**, not for HexaGen agents. Agent disposition of
bot comments is `.agents/REVIEW.md`. Qodo's review reference is
`best_practices.md` at the repo root.

Cite the owning document. Do not restate a rule that already has a section —
a restated rule drifts.

**Role:** DESIGN.md UI contracts, especially the gaps `hexagen-ui/no-arbitrary-tailwind-values` does not visit. CodeRabbit remains the primary guardian of the verifier-defect class in `best_practices.md`.

---

## Please do flag these

- **Arbitrary Tailwind the linter misses** (`DESIGN.md` §4.8). The ESLint rule
  `hexagen-ui/no-arbitrary-tailwind-values` is wired for `apps/web/features/**`
  and `apps/web/components/primitives/**` only. Two documented gaps are in-scope
  here and are **not** a licence to write magic numbers:
  - class names built inside **template literals** (`TemplateElement` nodes)
  - `apps/web/components/` **outside** `primitives/`
    Permitted exceptions are the two categories in §4.8 (bare `var(--token)`
    design-token references, and `transition-` / `will-change-` property-name
    lists) plus the exact-pattern table. `w-[calc(var(--x)-4px)]` and
    `w-[var(--x,280px)]` remain violations.

- **Off-scale spacing the linter misses** (`DESIGN.md` §4.7). Spacing must land
  on the §4.7 table — 1, 2, 3, 4, 6, 8, 12, 16 (0 cancels). Both `mt-0.5` (2px,
  off the 4px grid) and `p-5` (20px, on the grid but off the table) are
  violations; the nearest table step is the replacement.
  `hexagen-ui/no-off-scale-spacing` now covers `m-*`, `p-*`, `gap-*`,
  `space-x`/`space-y` and `scroll-m*`/`scroll-p*` — at `error` in
  `apps/web/components/primitives/**` and at `warn` in `apps/web/features/**`
  and `apps/web/components/**` pending their migration. Four gaps are in-scope
  for review and are **not** a licence to go off-scale:
  - class names built inside **template literals** (`TemplateElement` nodes)
  - `apps/web/app/**`, wired for neither Tailwind rule
  - **sizing** (`w`/`h`/`size`/`min-*`/`max-*`) and **positioning**
    (`inset`, `top`/`right`/`bottom`/`left`, `translate-*`), deliberately out
    of the rule's scope — flag an off-grid value there on its merits
  - anything the `warn` scopes surface but do not block

- **Presentation-only props** (`DESIGN.md` §3.4). `@hexagen/ui` props must
  extend `NoSemanticState<T>`. Forbidden information-state props (`data`,
  `loading`, `error`, `isFetching`, …) are a compile-time error in typed UI —
  still flag them in untyped JSX, `as any` / `as never` escapes, and
  `packages/template-engine/templates/**` (shipped customer payload, outside
  this repo's tsconfig).

- **Inline styles outside the canvas adapter** (`DESIGN.md` §4.9). Only
  `width`, `height`, `transform`, and `opacity`, and only in
  `apps/web/features/hexagon-canvas/adapters/CanvasNodeStyleAdapter.tsx`.
  Any other inline style is a violation, including other files under
  `hexagon-canvas/`.

- **Layer isolation** (`DESIGN.md` §3.1 / §3.3). `@hexagen/ui` must not import
  domain logic, database clients, ORMs, or raw server actions.

When proposing a fix, say what it does to inputs the current code already
handles — particularly whether it turns a loud failure into a quiet one.

---

## Please do not flag these

Copied from `best_practices.md` / `.coderabbit.yaml`. These are settled.

### Assertion style is settled

ADR-0044 Decision item 2 permits `expect()` in Vitest files and retains
`node:assert/strict`. Mixing the two styles in one file is not a violation.
Do not propose migrating `assert.*` to `expect()`. (ADR-0044 has no numbered
sections — cite Decision items, not `§N`.)

### The manifest is a registry, not an inventory

ADR-0057: `layers.*.ports` / `layers.*.adapters` are a curated ownership
registry. Accuracy is the invariant (a phantom entry is a defect).
Completeness is not — do not ask for an entry because a file exists.
`.architecture/**` is human-authored. Do not propose edits to
`manifest.yaml`, any `context.yaml`, or `invariants/**`.

### Repeated ESLint entries across scoped blocks are deliberate

ESLint flat config **replaces** rule options rather than merging them.
Removing a "duplicate" `no-restricted-imports` entry from a scoped block has
already caused a real regression on `main` here.

### Generated barrels

Some `index.ts` barrels carry an `@generated` marker and are emitted by
`@hexagen/sync`. Do not propose hand-edits — the next sync run reverts them.
If the export surface is wrong, the generator or the source module is the
fix.

### Template payload is shipped code

`packages/template-engine/templates/**` is emitted into customer projects.
"Outside the build" is not grounds for treating a defect there as cosmetic.
**Do** flag DESIGN.md / layering / typing errors in those files.

### Verifier defects are not this bot's job

Gates that pass without running, empty-population guards, tests that pass
for the wrong reason, and parser blind spots in checks belong to CodeRabbit
and Qodo. Do not duplicate them.

### Do not invent tokens

If DESIGN.md does not define a token, utility, or exception, do not create
one in a suggestion. Halt and say the document is missing it.
