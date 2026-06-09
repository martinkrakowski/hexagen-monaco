# ADR-0041: Wizard Applications Model — Project-Level Presentation Over Per-Context Fields

**Status:** Accepted
**Date:** 2026-06-08
**Authors:** Architecture Co-pilot, Human Architect
**Related to:** ADR-0004 (ci-build-typescript-monorepo-resolution)

---

## Context

A bounded context is a **domain boundary**, not a deployable application. Yet the
project wizard's `ContextFormInfrastructure.tsx` renders, **for each bounded
context**, five infrastructure selects — **API Backend** (`infrastructureTarget`),
**UI Frontend** (`uiFramework`), **Persistence** (`persistenceAdapter`),
**Messaging** (`messagingAdapter`), and **Telemetry** (`telemetryProvider`) —
backed by per-context fields on `ProjectConfig`
(`@hexagen/project-configuration` · `schema.ts`).

Surfacing **UI** and **API hosting** per context implies "one app per context".
The reported confusion — _"each bounded context surfaces both options for UI and
APIs … I only want a single Next.js application"_ — is the symptom.

### What the code actually does today (verified)

This is the crucial finding that scopes this ADR. The **app-derivation model
already collapses correctly**:

- `deriveApps(boundedContexts, allowSharedUi)`
  (`@hexagen/wizard-orchestration` · `wizard-to-manifest.ts`) with the **default**
  `allowSharedUi: true` emits **exactly one `web` app** (aggregating every
  non-shared context, framework chosen by `pickPreferredFramework`) **plus one
  aggregated `api` app**. It does **not** emit one app per context.
- The `api` app is **always** a single aggregated app under both `allowSharedUi`
  rules — the API surface is never per-context.
- Per-context divergence into multiple `web-<context>` apps happens **only** under
  `allowSharedUi: false`, which is the deliberate strict-enterprise / per-service
  isolation mode (`workspace-templates.ts`).

So the model is already right. **The defect is presentation, not derivation:** the
per-context form presents UI/API as per-domain-module choices, misrepresenting a
model that already aggregates them into one `web` + one `api`.

This reframes the original remediation plan item #7 (`Generator Scaffold & Wizard
Remediation Plan`) from "separate the application layer in the schema + rewrite
`deriveApps`" to "stop the **wizard** from presenting UI/API per context."

## Decision

Introduce a **project-level "Applications" presentation layer** over the
**existing** per-context fields, rather than a new persisted schema entity. Five
sub-decisions:

### D1 — Applications is a presentation reshape, not a new persisted field

`ProjectConfig`'s per-context `uiFramework` / `infrastructureTarget` fields
**remain the persisted source of truth** (no schema change, no data migration).
The wizard gains a **dedicated project-level "Applications" step** (see D5) that
collects a single UI framework + a single API/infrastructure target and **fans
that value out to every bounded context's per-context field**. Because every
context then carries the same `uiFramework` / `infrastructureTarget`, the existing
`deriveApps` collapse produces one `web` + one `api` with no derivation change.

_Rejected: a new project-level `applications: Application[]` schema field + a
`deriveApps` rewrite + a data migration. `deriveApps` already yields the desired
single-app shape, so the schema churn and migration risk buy nothing for the
common case._

### D2 — Remove the per-context UI/API selects entirely

`ContextFormInfrastructure.tsx` drops **API Backend** and **UI Frontend**. The
per-context form keeps only the **domain-owned driven infra** a context
legitimately owns: **persistence, messaging, telemetry**. (These remain
per-context and continue to flow through `wizard-to-manifest.ts` from
`bc.portConfiguration` / the per-context fields — out of scope for this ADR.)

_The strict-enterprise per-context-UI case (`allowSharedUi: false`) is no longer
expressible through per-context UI selects in the wizard; it remains expressible
via the template's `allowSharedUi` rule (D3). A future "advanced / micro-frontend"
opt-in can re-expose per-context UI if demand appears — explicitly deferred._

### D3 — `allowSharedUi` survives unchanged as a named field

`allowSharedUi` (`workspace-templates.ts`, default `true`) stays as-is. The
single-application preset **is** `allowSharedUi: true`. Strict-enterprise
templates keep `allowSharedUi: false` and continue to drive `deriveApps`'
per-context `web-<context>` isolation. No rename, no folding into an Applications
shape — it survives the move untouched.

### D4 — Migration / back-compat is a load-time presentation collapse, not a data migration

Because the per-context fields persist, **no stored data is migrated**. The only
collapse is computing the Applications panel's **initial value** when loading an
existing project whose contexts may carry divergent per-context UI/API values:

- **First non-empty wins**, evaluated in context order, for each of
  `uiFramework` and `infrastructureTarget`.
- A divergence (two contexts with different non-empty values) shows the winning
  value AND surfaces a **dismissible inline notice in the Applications step** —
  not merely a dev-console log, which is invisible to the non-developer loading a
  legacy project. Copy, e.g.: _"Your bounded contexts had different UI/API
  settings — we've unified them to «Next.js + Nitro». Change the selection below
  if needed."_ Saving re-fans the single value, converging the contexts.
- This mirrors the aggregation `deriveApps` already performs
  (`pickPreferredFramework`), so the wizard preview and the generated manifest
  agree.

### D5 — Applications is its own wizard step, placed before Bounded Contexts

The Applications config gets a **dedicated wizard step**, not a section bolted
onto an existing one, inserted **after `workspace_governance` and before
`bounded_contexts`** in `config.ts` (`wizardSteps`):

> Workspace Governance → **Applications** → Bounded Contexts → Peer Mappings →
> Ports → Add-Ons → Template Questions → Summary

Rationale:

- UI/API hosting is a **project-level** concern (like Workspace Governance); it
  does not belong inside the repeated per-context form. Nesting a single
  project-wide choice inside a per-context loop is what produced the original
  confusion.
- Placing it **before** Bounded Contexts frames the project ("one Next.js app +
  one API") before the user begins domain modelling, pre-empting the
  "one-app-per-context" misread at the point it would otherwise form.
- It makes the D1 fan-out **structurally cleaner**: because the choice is made
  before contexts exist, new contexts simply **inherit it as their default at
  creation** (`createEmptyContext`), rather than requiring a back-fill into
  already-created contexts.

**Consequence for the fan-out:** the Applications value is applied as the
**default for newly created contexts** AND **re-fanned to all contexts when the
Applications choice changes** — not a one-shot write — so contexts added after
the step still converge on the single value.

## Consequences

### Positive

- **Minimal blast radius**: no `ProjectConfig` schema change, no `deriveApps`
  change, no persisted-data migration. The change is confined to the wizard
  feature (`apps/web/features/project-wizard/`) plus an initial-value helper.
- **The common case becomes one choice**: a single project-level UI + API
  selection scaffolds one `apps/web` + one `api`, matching user expectation.
- **Legacy projects keep working** unchanged — their per-context fields still
  load; the panel collapses them for display.
- **`deriveApps` / `allowSharedUi` / manifest mapping are untouched**, so the
  generated-output correctness arc is not disturbed.

### Negative

- Per-context UI/API is no longer wizard-expressible (only the template-level
  `allowSharedUi` distinguishes shared vs isolated). Acceptable: that was the
  source of the confusion, and the strict case is rare and still reachable.
- The per-context fields remain in the schema as an internal representation that
  the UI no longer edits directly — a model/representation gap with a concrete
  risk: a future developer sees `uiFramework` / `infrastructureTarget` on the
  per-context schema and re-adds per-context UI editing elsewhere, unaware of this
  ADR. **Mitigation (required, see implementation):** a code-level comment on
  those fields in `schema.ts` points at ADR-0041 and states they are
  **wizard-managed via Applications-step fan-out, not direct per-context input** —
  making the gap self-documenting at the site of future confusion.

### Neutral

- A future "advanced / per-app" mode can layer a real `applications[]` field on
  top if multi-app / micro-frontend projects become common; this ADR does not
  preclude it, it defers it.
- The "new contexts inherit the choice, no back-fill" property (D5) assumes
  **linear forward navigation** through the wizard. If the wizard permits
  backward navigation or step-skipping such that contexts can be created _before_
  the Applications step is visited, the implementation must run a **back-fill
  sweep on Applications-step entry** (fan-out to any pre-existing contexts) — the
  same fan-out, applied on enter rather than only on change.

## Implementation sketch (for the follow-up PR, not this ADR)

**State plumbing (the wiring point — explicit).** The wizard holds `ProjectConfig`
in a single **react-hook-form** store; steps read/write it via
`useFormContext<ProjectConfig>()` (`control` / `getValues` / `setValue` /
`useWatch`), and bounded contexts are an array mutated with
`setValue("boundedContexts", …)` (see `BoundedContextStep.tsx`). There is no
separate undo/redo stack — RHF is the single source of truth — so **every fan-out
goes through `setValue` on that same store**; nothing writes context state by any
other path.

1. **Applications step** (new, dedicated; D5): registered in `config.ts`
   `wizardSteps` after `workspace_governance` and before `bounded_contexts`. Uses
   `useFormContext<ProjectConfig>()` like every other step. One `uiFramework`
   select + one `infrastructureTarget` select, defaulting to the single-app preset
   (Next.js + the project's API target). **Fan-out trigger:** on select change,
   `setValue("boundedContexts", contexts.map(c => ({ ...c, uiFramework, infrastructureTarget })), { shouldDirty: true })`
   — the same RHF path the other steps use, so dirty-tracking and persistence stay
   consistent.
2. **`createEmptyContext`**: change its signature to accept the current Applications
   values — `createEmptyContext({ uiFramework, infrastructureTarget })` — and seed
   the new context's fields from them (replacing today's hardcoded
   `infrastructureTarget: "nestjs"` / `uiFramework: ""`). `BoundedContextStep`'s
   add handler reads the values via `getValues()` and passes them in, so a context
   created after the Applications step inherits the choice without a back-fill.
3. **`ContextFormInfrastructure.tsx`**: remove the API Backend + UI Frontend
   selects (keep persistence / messaging / telemetry).
4. **Initial-value collapse** helper (D4): first-non-empty-wins across contexts;
   used to seed the step on project load and to drive the **dismissible inline
   divergence notice** in the Applications step (not a console-only log).
5. **Schema self-documentation** (mitigates the model/representation gap):
   add a comment on `schema.ts`'s per-context `uiFramework` /
   `infrastructureTarget` fields pointing at ADR-0041 and stating they are
   wizard-managed via Applications-step fan-out, **not** direct per-context input.
6. **Tests**:
   - **Fan-out**: changing the Applications selection writes the value to every
     existing context (via `setValue`).
   - **New-context default (gap-closer)**: a context created _after_ the
     Applications step is set carries the project's selected `uiFramework` +
     `infrastructureTarget` (guards the silent-inheritance-break scenario).
   - **Load-collapse**: divergent per-context values seed first-non-empty and
     raise the inline notice.
   - **`deriveApps` regression guard**: still yields one `web` + one `api` for the
     single-app preset (unchanged behavior).

## Verification

- Scaffolding a project with the single-app preset yields exactly one `apps/web`
  - one `api`, with no per-context UI/API toggles in the wizard.
- A legacy project with divergent per-context UI loads as a single Application
  (first-non-empty), logs the divergence, and converges on save.
- `deriveApps` unit tests are unchanged and green (no model change).

## References

- `Generator Scaffold & Wizard Remediation Plan` — item #7
  (`docs/planning/generator-scaffold-and-wizard-remediation.md`)
- `apps/web/features/project-wizard/steps/bounded-context-step/ContextFormInfrastructure.tsx`
- `packages/wizard-orchestration/src/application/wizard-to-manifest.ts` (`deriveApps`)
- `packages/project-configuration/src/domain/model/workspace-templates/workspace-templates.ts` (`templateRules.allowSharedUi` — preserved by D3)
- `packages/project-configuration/src/schema.ts` (per-context `uiFramework` / `infrastructureTarget` fields — D5 schema comment lands here)
- `apps/web/features/project-wizard/config.ts` (`wizardSteps` order — Applications step inserted per D5)
- `apps/web/features/project-wizard/steps/BoundedContextStep.tsx` + `steps/bounded-context-step/createEmptyContext.ts` (RHF `setValue` fan-out + new-context default)
