# Add NitroJS to the API/Backend Templates

**Status:** Proposed. Not started.
**Date:** 2026-06-06
**Parent:** Standalone. Touches the same "selector → manifest → generation" seam as [wire-architectural-template-into-generation.md](./wire-architectural-template-into-generation.md).

## Goal

Add **NitroJS** as a choice in the API/backend framework selector, which today offers **NestJS, Express, Serverless, Plain TypeScript**.

## Grounding — what an "API/backend template" actually is today

The selector is `BoundedContext.infrastructureTarget`, a per‑bounded‑context enum:

- **Catalog (single source):** `packages/project-configuration/src/schema.ts:79` — `z.enum(["nestjs", "express", "serverless", "plain-ts"])`.
- **Wizard options:** `apps/web/features/project-wizard/config.ts:25-30` (`apiFrameworkOptions`), rendered by `apps/web/features/project-wizard/steps/bounded-context-step/ContextFormInfrastructure.tsx:40` (`<select>` maps over `apiFrameworkOptions`, so adding to that list auto‑adds the option).

### Reality check: `infrastructureTarget` is advisory, not generative

A grep of every consumer shows the choice only feeds **display / metadata**, never file scaffolding:

| Consumer                                                                                                            | Use                                     |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `packages/visualization/.../generate-compass-nodes.ts:27`                                                           | node label only                         |
| `packages/prompt-compiler/...` + `packages/agentic-interaction/src/application/context-serializer.ts:82`            | LLM prompt context text                 |
| `apps/web/.../summary-step/BoundedContextsSummary.tsx:45`                                                           | summary display                         |
| `manifest-parser.ts:79`, `createEmptyContext.ts:15`, `config.ts:75`, `usePathNavigation.ts`, `useManifestImport.ts` | defaults (`"nestjs"`)                   |
| `wizard-to-manifest.ts:256`                                                                                         | sets `"plain-ts"` on the shared context |

A bounded context becomes `packages/<context>/` with the hexagonal DDD structure **regardless** of the backend picked. (Same shape as the architectural‑template selector before Phase 3 — the intent exists; the generator doesn't read it.)

### What _does_ materialize a backend app is a different axis

- `apps[].framework: AppFramework = "next.js" | "fastify" | "express" | "plain-ts"` (`packages/sync/src/types/manifest/apps.ts:3`).
- Scaffolded by `generateApps` + `BUILTIN_FRAMEWORK_TEMPLATES` (`packages/sync/src/generators/apps-framework-templates.ts`). **Only `next.js`, `fastify`, `plain-ts` have real templates**; `express` has none and falls through.
- The bridge `deriveApps` (`packages/wizard-orchestration/src/application/wizard-to-manifest.ts:483-545`) builds the single `api` app's framework from the **legacy** `bc.apiFramework` (`"Fastify" | "Express" | "NestJS"`, `schema.ts:86`) via `mapApiFramework` (`:33-40`: Fastify→`fastify`, everything else→`plain-ts`). **It never reads `infrastructureTarget`.**

So there are **three mismatched enums**, and the main selector is doubly disconnected from generation:

| Axis                                              | Values                                | Materializes code?            |
| ------------------------------------------------- | ------------------------------------- | ----------------------------- |
| `infrastructureTarget` (the selector in question) | nestjs, express, serverless, plain-ts | **No**                        |
| legacy `apiFramework` (feeds `deriveApps`)        | Fastify, Express, NestJS              | only Fastify→fastify template |
| `AppFramework` (what `generateApps` can build)    | next.js, fastify, express, plain-ts   | next.js, fastify, plain-ts    |

### Nitro is already assumed by the add-on layer

The add‑on/template system already treats **Nitro as the default server framework**:

- `packages/template-engine/templates/rate-limiting/manifest.json:12-16` — `"prompt": "Which server framework?", "options": ["nitro", "nextjs-api", "express", "fastify"], "default": "nitro"`, and its files live under `server/middleware/`, `server/utils/` (h3/Nitro file convention).
- `apps/web/features/project-wizard/steps/template-questions-step/template-questions.generated.ts:623,999-1000` lists `"nitro"` (default).

So the add‑on ecosystem expects a Nitro `server/` app that the **project backend selector can't currently produce** — adding Nitro closes that gap.

## Decision A — scope

How far does "add NitroJS" go?

| Option                                                         | Mechanism                                                                                        | Pros                                                                                                                                                                                                                                   | Cons                                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** — Phase 1 only (parity, cosmetic)                       | Add `"nitro"` to the enum + options (+ tests)                                                    | Tiny, low‑risk; Nitro becomes selectable/persisted/displayed exactly like the other four                                                                                                                                               | Materializes **no** Nitro code — because none of the four do either; a Nitro option that scaffolds nothing is especially hollow (people pick Nitro _for_ its scaffold/deploy) |
| **A2 (recommended)** — Phase 1 + Phase 2 (materialize), phased | Ship parity now; then emit a real Nitro app and make `infrastructureTarget` drive app generation | The choice means something; aligns the project backend with the Nitro `server/` convention the add‑ons already target; **the Phase 2 rewire fixes the dead selector for all four existing backends too, not just Nitro** (see Phase 2) | Larger; surfaces — and must resolve — the pre‑existing `infrastructureTarget`↔generation disconnect and the 3‑enum mismatch                                                   |

**Resolved: A2.** Do both, phased — ship Phase 1 (an honest, present option) first, then Phase 2 (make it real). A1 alone ships a hollow option for a framework whose entire value proposition is its scaffold/deploy. Locking this here so it isn't re‑litigated when implementation starts; mirrors the arch‑template "ship honesty first, differentiate next" (A1 → Phase‑1‑then‑3) discipline.

## Phase 1 — catalog parity (small, low-risk)

Value string: **`"nitro"`** (lowercase, matching the existing kebab values and the add‑on layer's `"nitro"`); label `"Nitro"`.

- [ ] `packages/project-configuration/src/schema.ts:79` — enum → `["nestjs", "express", "serverless", "plain-ts", "nitro"]`.
- [ ] `apps/web/features/project-wizard/config.ts:25-30` — add `{ value: "nitro", label: "Nitro" }`.
- [ ] Leave defaults as `"nestjs"` (no behavior change). Display/serializers interpolate the value generically — no per‑value edits.
- [ ] Tests/fixtures that enumerate the options or round‑trip the value: `apps/web/features/project-wizard/utils/analyzeManifestCompleteness.test.ts`, any wizard snapshot, import/export round‑trip of `infrastructureTarget` (`useManifestImport`, `usePathNavigation`).

**Acceptance:** selecting Nitro persists, round‑trips through `wizardToManifest`, and appears in visualization/summary/prompt context; the other four are byte‑identical to before.

## Phase 2 — materialize a Nitro backend (the differentiator)

> **Side-effect worth stating plainly: Phase 2 fixes the selector for _all_ backends, not just Nitro.** Today none of `nestjs / express / serverless / plain-ts` reach generation — `infrastructureTarget` is a dead selector (it only labels and prompts). The `infrastructureTarget` → `deriveApps` rewire below is the architectural change that makes the choice _mean something at all_; Nitro is simply the first value handed a real template. So Phase 2 is a general fix to a long-standing dead selector, with Nitro as its proof case — and the seam it opens (an `infrastructureTarget` value → a materializable app framework) is exactly where future real templates for the other four would plug in.

- [ ] `packages/sync/src/types/manifest/apps.ts:3` — add `"nitro"` to `AppFramework` (and consider `AppDriver`).
- [ ] `packages/sync/src/generators/apps-framework-templates.ts` — add a `nitro` entry to `BUILTIN_FRAMEWORK_TEMPLATES`:
  - **package.json:** `nitropack` dep; scripts `dev: nitro dev`, `build: nitro build`, `prepare: nitro prepare`, `preview: node .output/server/index.mjs`; `"type": "module"`.
  - **entry/files:** a Nitro route `server/routes/index.ts` → `export default defineEventHandler(() => ({ status: 'ok' }))`, plus `nitro.config.ts` → `export default defineNitroConfig({})`. ⚠️ This needs **more than one file**, but `AppFrameworkConfig.entryPoint` is a single file (`apps.ts:14-22`). **Decision:** either extend the framework‑template shape to emit a small file set, or piggyback `nitro.config.ts` via an additional template. (Smallest viable: extend `AppFrameworkConfig` with an optional `extraFiles`.)
  - **tsconfig:** ⚠️ **main risk.** Nitro generates types via `nitro prepare` and expects `extends: "./.nitro/types/tsconfig.json"`, which doesn't exist until prepared — unlike the other apps' `composite`/`emitDeclarationOnly` + project‑refs model. **Decision:** make the Nitro app **standalone** (exclude from the workspace composite build / project references) so a fresh `yarn typecheck` doesn't fail on missing `.nitro` types.
- [ ] **Wire `infrastructureTarget` → app generation.** Extend `deriveApps` to read `infrastructureTarget` (the real selector) and map `nitro → "nitro"`, others → current behavior (`plain-ts`). Reconcile with the legacy `apiFramework` path (prefer `infrastructureTarget`; keep `apiFramework` as fallback for imported legacy manifests). This is the first `infrastructureTarget` value that truly materializes — a deliberate, contained precedent.
- [ ] **Two-worlds + CI guard.** Add a `generated-stub-typecheck`‑style test that generates a project with a Nitro `api` app and asserts the scaffold shape; ensure Nitro's `.nitro` types don't break the workspace typecheck (the standalone‑tsconfig decision above). Sync runs in both `self-regen` and `external` modes — verify the Nitro template only affects generated projects.
- [ ] **(Optional alignment)** A Nitro backend is the natural host for the `server/`‑convention add‑ons (rate‑limiting et al., which already default to `nitro`). Note as a follow‑on once Nitro materializes.

### De-risk gate — MUST pass before any template code

This is a hard gate, same discipline as the rest of this arc (de-risk before building). **Before writing a single line of the Nitro `BUILTIN_FRAMEWORK_TEMPLATES` entry, the `deriveApps` wiring, or the tests:** generate a throwaway Nitro app to a temp dir and actually run `nitro prepare` + `tsc` (and `nitro build`) to confirm it builds and that the tsconfig / `.nitro`‑types interplay works inside the workspace's typecheck. The tsconfig/`.nitro`‑types model is the **only real unknown** — everything else mirrors the existing `fastify` template. Lock the template shape (especially the tsconfig decision in Open Decision #4) to whatever that experiment proves, not to assumptions. If the gate can't be made green, reconsider materializing Nitro as a standalone app vs a workspace member before proceeding.

## Files touched (summary)

| Phase | File                                                                  | Change                                                                  |
| ----- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1     | `packages/project-configuration/src/schema.ts`                        | enum + `nitro`                                                          |
| 1     | `apps/web/features/project-wizard/config.ts`                          | `apiFrameworkOptions` + Nitro                                           |
| 1     | wizard option/round‑trip tests                                        | cover `nitro`                                                           |
| 2     | `packages/sync/src/types/manifest/apps.ts`                            | `AppFramework` + `nitro` (+ `AppFrameworkConfig.extraFiles?`)           |
| 2     | `packages/sync/src/generators/apps-framework-templates.ts`            | `nitro` builtin template                                                |
| 2     | `packages/wizard-orchestration/src/application/wizard-to-manifest.ts` | `deriveApps`/`mapApiFramework` read `infrastructureTarget`, map `nitro` |
| 2     | `packages/sync/__tests__/integration/*`                               | Nitro scaffold + tsc guard                                              |

## Open decisions to confirm before coding

1. **Scope:** Phase 1 only (parity), or Phase 1 + 2 (materialize)? Recommend both, phased.
2. **Value string:** `"nitro"` (recommended) vs `"nitrojs"`. The add‑on layer uses `"nitro"`.
3. **Enum reconciliation:** in Phase 2, switch `deriveApps` to read `infrastructureTarget` (recommended) vs keep the legacy `apiFramework` bridge. Decide whether to also expose the materializable `fastify` in `infrastructureTarget` (out of scope here, but the mismatch is worth a follow‑up).
4. **Nitro app tsconfig:** standalone (recommended) vs participate in the workspace composite build.
