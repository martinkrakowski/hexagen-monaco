# Hydrate the Code View with Add-On Template Outputs

**Status:** Decisions resolved — ready for PR 1
**Date:** 2026-06-03 (updated after enterprise review)

## Problem

The wizard's **Step 5 — Add-On Templates** (`packages/template-engine/templates/*` — bullmq, llm-adapter, supabase, auth, Adobe, …) don't reach the **code view**. A selected template shows in the **visualizer**, but its scaffolded files never appear in the code/Monaco view, the project ZIP, or the GitHub export.

## Root cause

Both views get the same `wizardData` (which carries `addOnsAnswers`), but use it differently. The visualizer builds its graph **client-side** → add-ons surface. The code view POSTs to `/api/generate`, which does only `wizardToManifest(wizardData)` → `@hexagen/project-generation` (core hexagon from the manifest). The template-engine is **never invoked by any codegen path**: `/api/generate` imports no template-engine and never reads `addOnsAnswers`; `project-generation` has zero template references; `wizardToManifest` even zeroes `addOnsAnswers`; and **`apps/web` doesn't depend on `@hexagen/template-engine`** (it's wired only into the wizard's selection/questions steps and the CLI). A parallel-tracks wiring gap, not a logic bug.

## Resolved decisions

| #   | Decision                    | Choice                                                                                       | Notes                                                                                                                                   |
| --- | --------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Template content at runtime | **Generated TS module** (`template-files.generated.ts`, extend the `*.generated.ts` pattern) | Serverless/standalone-safe, no runtime `fs`. **No compression** — payload is ~0.6 MB (see audit); revisit only if it balloons.          |
| 1   | Overlap precedence          | **Template overrides core, with a warning**                                                  | Plus a **structured-file guard** (below) instead of a merge engine, since no template currently emits `package.json`/`.env`/`tsconfig`. |
| 2   | Scope                       | **All three outputs** (code view + ZIP + GitHub)                                             | Merge at the generation-use-case level so all sinks share one path — avoids "in Monaco but missing from ZIP" state drift.               |
| 3   | UI surfacing of warnings    | **Defer to PR 3**                                                                            | Until then, log unresolved-var / override warnings to backend telemetry; return them in the API response for later UI mapping.          |

## Enterprise review — friction points (refined with an output audit)

An audit of all 319 distinct output paths across the 44 templates grounds the review:

1. **Structured-file merge (package.json / .env / tsconfig).** _Raised as: a file-level override would destroy core `package.json` deps._ **Audit: 0 templates emit `package.json`, `tsconfig*`, or a real `.env`** — the 39 env outputs are namespaced `.env.<name>.example`, and deps are delivered via each manifest's `checklist` (e.g. bullmq: "npm install bullmq ioredis"), not a `package.json` output. **So this collision doesn't exist today.** → Don't build JSON/AST merge machinery now. Instead:
   - Add a **CI guard** (template-validation test) that **fails** if any template's `outputs` include a collision-prone structured file (`package.json`, `tsconfig*`, real `.env`, a shared root `index.ts`) — forcing an explicit merge-strategy decision before such a template can ship.
   - Document the **JSON-aware merge policy** (deep-merge keys for `package.json`/`.env`; `.conflict` copy on merge failure) as the strategy to implement _when_ the guard first trips. This keeps the door open without speculative work.

2. **Bundle bloat / "50 MB serverless limit".** _Raised as: inlining files into a TS module risks the function size cap._ **Correction:** this app deploys as a **standalone Node server in a Docker image on a VPS** (`output: 'standalone'` + `deploy.yml` → SCP to VPS), **not** a size-capped serverless function — the ~50 MB Vercel/Lambda limit does not apply. And the payload is **~0.6 MB (344 files)**. → No compression/base64 needed; the generated module is fine as-is. Add a lightweight **size-budget assertion** on `files/**`: **soft warning at 5 MB, hard CI failure at 15 MB** — room to breathe on a VPS footprint without constant tuning.

3. **In-memory emitter lifecycle.** Agreed. The output `Map<path,content>` must be **request-scoped** (instantiated per `/api/generate` call, no module-level accumulation). Only the _immutable_ template content (the generated module) is module-level/shared. Bake this into PR 1's adapter contract and add a note in `WIRE.md`.

4. **Adapter-vs-port boundary (leaky abstraction).** _Raised as: collisions on core ports suggest leaky templates._ **Audit confirms it: 27 outputs land in `src/domain/`** — `domain/ports/out/*.port.ts` (llm-client, firefly-_, photoshop, indesign, agent-_, …), plus `domain/errors/*` and `domain/value-objects/user-context.ts`. So templates _do_ emit domain ports/primitives, not just `infrastructure/` adapters — exactly the leak flagged. The precedence policy (template overrides core, with warning) handles the collision pragmatically for this PR. **Follow-up (separate):** tighten template design so add-ons provide adapters under `infrastructure/` and the core owns `domain/ports`; track which templates are "port-defining" vs "adapter-only". Not a blocker for the wiring.

## Design

### Phase 0 — Collision audit + guard _(cheap, do first)_

- Land the template-validation guard from friction-point #1 (fails CI on collision-prone structured-file outputs) and the size-budget assertion (#2). This locks the assumptions PR 1/PR 2 rely on.

### Phase 1 — Headless adapters + materialize use case (`@hexagen/template-engine`)

- **Generated content module** `template-files.generated.ts` (path → raw string), produced by extending `apps/web/scripts/generate-template-questions.ts` (or a sibling). Covers every template's `outputs`.
- **`InMemoryFileEmitter implements FileEmitterPort`** — reuse the shared interpolation (`interpolate` from `@hexagen/shared`) + `isOutputEnabled` gating extracted from `FileSystemFileEmitter`; collect into a **request-scoped** `Map<path,content>`; no disk, no `.conflict` writes (precedence handled at merge time). Reads source from the generated module.
- **`InMemoryTemplateConfigStore`** — `emptyConfig()`, no-op `save` (fresh generation; `type:"auto"` derivation still works as config accumulates within `execute`).
- **`DefaultingQuestionEngine`** — returns `question.default` + records a warning if a selected template has an unanswered question (defensive; the wizard's template-questions step should fill these).
- **`MaterializeAddOnsUseCase`** — wires the above + `AddTemplateUseCase` (`overrideAnswers = addOnsAnswers`, `templateIds = Object.keys(addOnsAnswers)`) → returns `{ files: Map, warnings: string[] }`. Unit-tested. No web change.

### Phase 2 — Wire into the generation path (all three outputs)

- Add `@hexagen/template-engine` as a dependency of the generation layer.
- Pass `addOnsAnswers` through to generation (currently dropped by `wizardToManifest`).
- After core `project.files`, run `MaterializeAddOnsUseCase` and **merge by precedence**: template overrides core with a warning per overridden path; structured-file paths can't collide (guarded in Phase 0). Collect `warnings` into the `/api/generate` response and **log to telemetry, deduplicated per generation run** (the 27 domain-port overrides × `isStale`-debounced re-generations would otherwise flood telemetry — emit each unique `{path, reason}` once per run).
- Integration tests: `addOnsAnswers` → template files present in `files`; precedence on a `domain/ports/out` collision; **empty `addOnsAnswers` → byte-identical to today** (no-regression).

### Phase 3 _(optional)_ — UI surfacing

- Render warnings (unresolved vars / overrides) in the code view; optionally badge template-originated files.

## Risks

- **Runtime template availability** — fully mitigated by the generated module (Decision 0).
- **Bundle/perf** — ~0.6 MB payload, VPS server (no function cap); `/api/generate` is debounced via `isStale`. Low risk; size-budget assertion guards future growth.
- **Domain-port collisions** — real (27 paths); handled by precedence now, template-design tightening tracked separately.

## Out of scope

- Building JSON/AST structured-file merging (no template needs it yet; guarded for when one does).
- Payload compression (premature at 0.6 MB).
- Tightening template port/adapter boundaries (follow-up).
- Linking the step-4 port-catalog to templates (`CompanionBanner` suggestion path) — tracked separately.
- Versioning / publish / deploy flows.

## PR breakdown

1. **PR 1** — Phase 0 guard + Phase 1 (generated module, in-memory adapters, `MaterializeAddOnsUseCase`, unit tests). No web behavior change.
2. **PR 2** — Phase 2 wiring (pass `addOnsAnswers`, merge with precedence, telemetry, integration tests, add the dep). All three outputs.
3. **PR 3** _(optional)_ — UI surfacing of warnings / template-file badges.
