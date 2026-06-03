# Wire the Add-On Materializer into Generation (PR 2)

**Status:** Plan / not started
**Date:** 2026-06-03
**Parent:** `hydrate-code-view-with-addon-templates.md` (overall plan) · builds on **PR 1** (#212, the in-memory materialization engine) and **#211** (Phase 0 guard)

## Goal

Make the **code view, the project ZIP, and the GitHub export** all include the selected add-on templates' files — by feeding the wizard's `addOnsAnswers` through generation and merging `InMemoryAddOnMaterializer`'s output into the generated project.

## The integration reality (grounding)

`GenerateProjectUseCase.execute({ manifest, exportConfig })` (`@hexagen/project-generation`) is **filesystem-based**:

1. `generator.generateAt(tempDir, manifest)` → writes the core project into a `/tmp` dir **and** returns a `project` whose `.files` is the in-memory Map the route returns for the code view.
2. `exporter.export(tempDir, exportConfig)` → **zips or GitHub-pushes that temp directory**.

So the two consumer surfaces diverge: the **code view** reads `project.files` (Map); the **ZIP/GitHub** read the **temp dir on disk**. To cover all three, the merge must update **both**: write each materialized add-on file into `tempDir` _and_ into `project.files`.

→ The merge belongs **inside `GenerateProjectUseCase`**, after `generateAt` and **before** `export` (not in the `/api/generate` route — the route can't inject into a ZIP the use case already built).

## Architecture (arch-linter-compliant)

`project-generation`'s `application` layer is `ports-only` (per `layer-rules.yaml`), so it must **not** import `@hexagen/template-engine` directly. Instead:

- **`project-generation`** defines a new out-port `AddOnMaterializerPort` and consumes it in the use case. No new package dep.
- **`template-engine`** (PR 1 already has the engine) adds a **generated bundle** + a self-contained factory `createInMemoryMaterializer()` (generated-backed registry + loader → `InMemoryAddOnMaterializer`).
- **`apps/web`** (the composition root, `wire.server.ts`) adapts `template-engine`'s materializer to `project-generation`'s `AddOnMaterializerPort` and injects it into `getGenerateProject`. `apps/web` gains the `@hexagen/template-engine` dependency (the only new consumer).

```
apps/web/wire.server.ts ──(injects AddOnMaterializerPort impl)──▶ GenerateProjectUseCase (project-generation/application)
        │ wraps                                                          │ uses port, merges into tempDir + project.files
        ▼
template-engine: createInMemoryMaterializer()  ── generated bundle (manifests + file contents)
```

## Steps

### Step A — Generated bundle + factory (`@hexagen/template-engine`)

- A generation script (mirror `apps/web/scripts/generate-template-questions.ts`, incl. its `--check` CI parity check) emits a `template-bundle.generated.ts`: `{ manifests: TemplateManifest[]; files: Record<"<id>/<relPath>", string> }` for all templates. ~0.6 MB; serverless-safe (imported, not `fs`).
- A generated-backed `TemplateRegistryPort` (from `bundle.manifests`) and a `TemplateFileLoader` (from `bundle.files`).
- `createInMemoryMaterializer(): InMemoryAddOnMaterializer` wiring both — so the web side imports one function, no `fs`.
- **CI parity test** (`--check`): fail if the bundle diverges from `templates/` (so a new/changed template can't ship stale). Complements the Phase 0 collision/budget guard.

### Step B — Port + merge (`@hexagen/project-generation`)

- New out-port `AddOnMaterializerPort { materialize(addOnsAnswers): Promise<{ files: Map<string,string>; warnings: string[]; errors: string[] }> }` — it mirrors the engine's **non-throwing** contract (PR 1's `MaterializeAddOnsResult`): invalid / conflicting / cyclic selections come back as `errors`, never thrown.
- Extend `GenerateProjectInput` with `addOnsAnswers?: Record<string, AnswerMap>`; constructor gains an optional `materializer?: AddOnMaterializerPort`.
- After `generateAt`, before `export`: if `addOnsAnswers` non-empty and a materializer is present, materialize, then for each `(rel, content)`:
  - **write to `path.join(tempDir, rel)`** (mkdir -p) → ZIP/GitHub pick it up,
  - **`project.files.set(rel, content)`** → code view shows it,
  - **precedence:** template overrides core (overwrite), pushing a warning per overridden path. (Structured-file collisions are impossible — Phase 0 guard.)
- Add `warnings?: string[]` **and `errors?: string[]`** to `GenerateProjectOutput`. On non-empty `errors` the materializer returned no files, so the merge is a no-op — the **core project still generates** and the errors are passed through, not thrown.

### Step C — Thread answers + wire + surface (`apps/web`)

- `/api/generate`: extract `addOnsAnswers` from `wizardData` and pass into `GenerateProjectInput` (today `wizardToManifest` zeroes it — read it straight off `wizardData`).
- `wire.server.ts`: build the `AddOnMaterializerPort` adapter from `template-engine`'s `createInMemoryMaterializer()`; inject into `getGenerateProject`. Add `@hexagen/template-engine` to `apps/web` deps.
- Return **both `warnings` and `errors`** in the API response — `errors` drives a 400/validation response for a bad add-on selection (the core project may still be offered), while a real failure stays a 500. **Log both to telemetry, deduplicated per generation run** (per the overall plan).

### Step D — Tests

- **Unit (project-generation):** merge precedence — a template file overwrites a core file at the same path in **both** `project.files` and the temp dir, with a warning; empty `addOnsAnswers` → use case behaves exactly as today (no-op).
- **Integration (apps/web):** `POST /api/generate` with `addOnsAnswers` → response `files` include add-on outputs; a `zip` request's archive contains them; an **invalid add-on selection → response carries `errors` (not a 500) and the core project still generates**; **empty `addOnsAnswers` → byte-identical to today** (no-regression).

## Decisions

Carried from the overall plan: generated TS module · template-overrides-core + warning · all three outputs · defer UI to PR 3 (telemetry meanwhile, dedup per run) · 5 MB soft / 15 MB hard budget.

New for PR 2:

- **Materialization is an injected port** into `project-generation` (not a direct `template-engine` dep) — keeps `application` ports-only and the arch-linter green.
- **The generated bundle lives in `template-engine`**, exposed via one `createInMemoryMaterializer()`; `apps/web` is the sole new consumer (composition root).
- **The merge writes to both the temp dir and `project.files`** — the key nuance, since ZIP/GitHub read the dir while the code view reads the Map.

## Risks

- **`project.files` mutability** — confirm it's a mutable Map (the route already iterates it); if frozen, reconstruct.
- **Temp-dir write ordering** — must run after `generateAt` so template-overrides-core wins; mkdir -p per file.
- **Web bundling** — the generated bundle must ship in the standalone build via `template-engine`'s dist (imported, so traced). Verify on a `next build`.
- **Bundle staleness** — mitigated by the `--check` CI parity test.

## Out of scope

- UI surfacing of warnings / file badges (PR 3).
- Tightening templates that emit into `domain/` (separate follow-up from the overall plan).
- Any change to the lock-step versioning / publish / deploy flows.

## Suggested split

- **PR 2a** — Step A (generated bundle + `createInMemoryMaterializer` + parity test) in `template-engine`. Self-contained, unit-tested.
- **PR 2b** — Steps B + C + D (port + merge + web wiring + integration tests). Depends on 2a.
