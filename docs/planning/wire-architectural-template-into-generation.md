# Wire the Architectural Template Into Generation

**Status:** Phases 1 (#235) + 2 (#236) shipped; `generateApps` traversal guard shipped (#237). Decision B → **B1**, Decision A → **A1**. Phase 3 scoped → [materialize-cross-context-communication.md](./materialize-cross-context-communication.md).
**Date:** 2026-06-05
**Parent:** Standalone. Originates from a verification of the step‑1 "Architectural Template" selector (`WorkspaceGovernanceStep` → `TemplateSelector`).

## Goal

Make the step‑1 **Architectural Template** choice (Modular Monolith / Strict Enterprise / Micro‑Frontend) actually shape the generated project, so the selection delivers what the cards promise. Today the selector is correctly wired into form state and the value reaches the manifest — but it changes almost nothing observable, and **two of the three templates produce byte‑identical output**.

## Grounding — what actually happens now

The selector is **not** dead UI. `TemplateCard` is a real button → `field.onChange(template.id)` → `governance.workspaceTemplate` (`TemplateSelector.tsx:77`), and the value flows all the way to generation:

`useProjectGenerationFlow.ts` → `wizardToManifest(config)` → `POST /api/generate` → `getGenerateProject` (`apps/web/app/lib/wire.server.ts:133`) → `ExternalSyncEngineAdapter` → `SyncEngine.run()` → `generateArchitectureFiles`.

But running `wizardToManifest` against all three templates with an identical 2‑context project (`orders` → `billing`) shows how little the choice actually moves:

| Output                                                                                       | modular‑monolith           | strict‑enterprise                     | micro‑frontend                      |
| -------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------- | ----------------------------------- |
| manifest `architecture` / `workspaceTemplate`                                                | label only                 | label only                            | label only                          |
| manifest `orders.depends_on`                                                                 | `["shared","billing"]`     | `["shared"]`                          | `["shared"]`                        |
| **rest of the manifest**                                                                     | baseline                   | **identical to micro‑frontend**       | **identical to strict‑enterprise**  |
| `.architecture/invariants/layer-rules.yaml`                                                  | no `cross_context` block   | `+ required_communication: event-bus` | `+ required_communication: network` |
| `.architecture/invariants/linter-config.yaml`                                                | default                    | `+ deny_sibling_imports`              | **identical to strict‑enterprise**  |
| `.architecture/generator.config.yaml`                                                        | `workspace_template: <id>` | `<id>`                                | `<id>`                              |
| **generated source code** (entities, ports, adapters, use‑cases, `package.json`, `tsconfig`) | baseline                   | **identical**                         | **identical**                       |

So the only _structural_ effect is dropped `depends_on` for the two strict modes, plus a few advisory YAML lines that the generated repo's arch‑linter would consume **if** the user runs lint there. There's nothing for `deny_direct_imports` to catch in a fresh scaffold (the deps were already removed and no cross‑context code exists yet), so even that is latent.

### The template _rules_ are mostly decorative

The domain model (`packages/project-configuration/src/domain/model/workspace-templates/workspace-templates.ts`) carries a rich `rules` object — `allowSharedUi`, `crossContextCalls` (`in-process` / `event-bus` / `network`), `strictness` — but the generator consumes almost none of it:

| Rule                | Where it's read                                                                                                                                                          | Drives generation?                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `strictness`        | `wizard-to-manifest.ts:64` (via a **hardcoded id check**, not the rule), `PeerContextMappingStep.tsx:59` (default mapping boundary), `architecture-files.ts:83` (via id) | Weakly — `depends_on` gating + advisory YAML                                          |
| `crossContextCalls` | `TemplateSelector.tsx:30`, `TemplateCard.tsx:44` — **display only**                                                                                                      | **No** — no broker, publisher, RPC client/server, or HTTP stub is ever emitted        |
| `allowSharedUi`     | `TemplateSelector.tsx:39` — **display only**                                                                                                                             | **No** — `deriveApps` (`wizard-to-manifest.ts:305`) always emits one shared `web` app |

**Root cause:** `wizardToManifest` hardcodes `isStrictTemplate = template === "strict-enterprise" || template === "micro-frontend"` (`:64‑65`) and never resolves `getWorkspaceTemplate(id).rules`. The intent model exists; the generator just doesn't read it.

### Useful seam already in place

`generateApps` (`packages/sync/src/generators/apps.ts:66`) iterates `manifest.apps` and scaffolds one `apps/<name>/` per entry, deduping by `name`. The `App` type is `{ name; framework?; depends_on? }` (`packages/sync/src/types/manifest/apps.ts:5`). So emitting **per‑context** web apps (`web-orders`, `web-billing`) needs no generator change — only a richer `deriveApps`.

## Decision A — strict‑enterprise vs micro‑frontend

They are indistinguishable in everything that ships except ~2 words in `layer-rules.yaml`. Until cross‑context communication is materialized (Phase 3), keeping both is a promise we don't honor.

| Option                                                         | Mechanism                                                                                                            | Pros                                                                                 | Cons                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **A1 (recommended)** — keep all three; close the gap in phases | Ship Phase 1 (honesty + rules‑as‑source‑of‑truth) now; let the two strict modes genuinely diverge when Phase 3 lands | No catalog churn; preserves the intended product surface; honest copy in the interim | The two strict cards stay near‑identical until Phase 3                                       |
| **A2** — collapse to two templates now                         | Drop `micro-frontend` until Phase 3 differentiates it                                                                | Removes a distinction that currently means nothing                                   | Schema enum change + saved‑project migration for the dropped id; reverses once Phase 3 ships |

**Resolved: A1.** The distinction is real _intent_; the fix is to make the generator honor it, not to delete the option. A2 trades a cosmetic problem for a migration. Phase 3 (the differentiator) is scoped in [materialize-cross-context-communication.md](./materialize-cross-context-communication.md).

## Decision B — what `allowSharedUi: false` should generate

| Option                                               | Mechanism                                                                                                                             | Pros                                                                                                                    | Cons                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **B1 (recommended)** — per‑context web apps          | When `allowSharedUi` is false, `deriveApps` emits one `web-<context>` app per UI‑bearing context instead of a single aggregated `web` | Visible, truthful structural difference; reuses the existing per‑name apps generator; matches "UI isolated per context" | More directories in the output for isolated templates                                 |
| **B2** — single app, isolation enforced only by lint | Keep one `web` app; rely on `linter-config.yaml` to forbid shared‑UI imports                                                          | Smallest change                                                                                                         | Output looks identical to shared‑UI mode; reproduces today's "does nothing" complaint |

**Resolved: B1** (per-context web apps) — the smallest change that makes the rule _observable_ in the artifact, which is the whole point. Implemented in Phase 2.

## Steps

### Phase 1 — honesty + rules‑as‑source‑of‑truth (`wizard-orchestration` + cards) — small, no new generation semantics

> **Implemented 2026‑06‑05** (PR #235) — steps 1‑4 below. The generated manifest/project is unchanged for every template id (the refactor is behaviour‑preserving); it makes `template.rules` the source of truth, adds a frozen `FALLBACK_RULES` so an unknown id degrades explicitly, and corrects the over‑promising card copy. 43 `wizard-orchestration` tests pass (8 added); package typecheck/lint clean. Also routes `manifest-parser` template resolution through the same catalog (folded in during review). The `allowSharedUi` detail line was removed from the card and returns in Phase 2 once it's structural.

1. **Resolve the template once, drive off `rules`.** In `wizardToManifest`, replace the hardcoded `isStrictTemplate` (`:64‑65`) with `const rules = getWorkspaceTemplate(template)?.rules ?? FALLBACK_RULES;`. Gate `depends_on` (`:255‑264`) on `rules.crossContextCalls === "in-process"` (direct deps allowed) rather than the id list. Behavior is unchanged for the three known ids, but the rules object becomes the single source of truth and a future template needs no edits here.
2. **Export a shared fallback.** Add a `FALLBACK_RULES` (the `modular-monolith` rules) next to `workspaceTemplates` so both `wizardToManifest` and any other consumer degrade identically when an unknown id slips through (drifted/legacy saved projects — Path 4 preserves these verbatim).
3. **Reword the cards to match today's reality (interim).** `TemplateSelector.tsx` / `TemplateCard.tsx` currently advertise "communicate via event bus" / "via network RPC" / "Shared UI app allowed" — none of which Phase 1 makes real. Until Phase 2/3 land, soften the copy (e.g. label the comms line "enforced by lint invariants" rather than implying generated wiring) so the UI stops over‑promising. Re‑promote the copy as each later phase ships.
4. **Tests:** `wizardToManifest` snapshot per template is unchanged by the refactor; an unknown template id falls back to `in-process` semantics (deps kept) rather than throwing; the card copy reflects the advisory wording.

### Phase 2 — make `allowSharedUi` observable (`deriveApps`) — medium (Decision B1)

> **Implemented 2026-06-05** (branch `feat/architectural-template-phase-2`, stacked on #235) — `deriveApps` now honours `allowSharedUi`: flexible templates keep the single shared `web` app (output unchanged), while strict templates emit one isolated `web-<context>` app per UI-bearing context plus the aggregated `api`. The card's UI line returns truthfully ("Single shared UI app" vs "Separate UI app per context"). This is **behaviour-changing for the two strict templates** — intended; it's the first real differentiator — while modular-monolith output stays byte-identical. New `wizard-to-manifest.apps.test.ts` covers shared vs isolated, headless-context omission, and the always-single `api`.

1. **Per‑context web apps.** Extend `deriveApps` (`wizard-to-manifest.ts:305`) to read `rules.allowSharedUi`. When `false`, emit one `web-<contextName>` app per UI‑bearing context (`uiFramework !== ""`), each `depends_on` only its own context (+ `shared`); when `true`, keep today's single aggregated `web`. The `api` app derivation is unchanged. Output stays deterministic (sorted, fixed order).
2. **Guard the no‑UI case.** If no context declares a `uiFramework`, emit no web app (today's `deriveApps` already returns `[]` when there are no non‑shared contexts — preserve that).
3. **Tests:** `allowSharedUi: false` + two UI contexts → two `web-*` apps with isolated `depends_on`; `allowSharedUi: true` → one aggregated `web` (byte‑identical to today); no‑UI project → no web app under either rule. End‑to‑end: run the `SyncEngine` (external mode) on each and assert the `apps/` tree differs.

### Phase 3 — materialize `crossContextCalls` (`sync` generators + templates) — large; the real differentiator

> **Scoped 2026-06-06** → [materialize-cross-context-communication.md](./materialize-cross-context-communication.md) (Decision A → A1; transport realism → C1). The high-level steps below are superseded by that detailed plan.

1. **Event‑bus boundary (`event-bus`).** For each cross‑context edge in a project whose template requires `event-bus`, scaffold a message‑bus outbound port + adapter on the consumer and a subscriber on the provider (reuse the `messaging` package's BullMQ/Temporal/RabbitMQ adapter shapes already offered in the wizard). Wire `publishedEvents` / `subscribedEvents` so the edge is real code, not just a denied import.
2. **Network boundary (`network`).** For `network` templates, scaffold an RPC/HTTP outbound client port + adapter on the consumer and a controller/handler on the provider, so cross‑context calls have a transport. This is what finally separates micro‑frontend from strict‑enterprise (Decision A1's payoff).
3. **Keep the invariants honest.** The `.architecture/invariants/layer-rules.yaml` already declares `required_communication`; Phase 3 makes generated code satisfy it, so the arch‑linter guards a real contract instead of an empty one.
4. **Tests:** per boundary type, assert the generated consumer/provider files exist and reference the bus/RPC port; assert the arch‑linter passes on the generated repo (no direct sibling import, communication present); modular‑monolith remains import‑based with no broker/RPC scaffolding.

## Decisions

- **Rules, not ids, drive the manifest** (Phase 1). The id→behavior mapping now resolves through `template.rules` (and the catalog via `getWorkspaceTemplate`) in both `wizardToManifest` and `manifest-parser`, so adding a fourth template is a data change there, not a code change. The one spot still keyed off the template **id** is `architecture-files.ts` (it selects the `.architecture` YAML by id) — left as-is deliberately to avoid a `@hexagen/sync → @hexagen/project-configuration` dependency; the id is already a stable manifest contract.
- **`allowSharedUi` becomes structural via per‑context apps** (Decision B1) — the cheapest way to make an advertised rule visible in the artifact.
- **Cross‑context comms is the headline feature and the largest lift** (Phase 3); it's deliberately last so the honesty fix (Phase 1) and the first real differentiator (Phase 2) can ship independently.
- **No schema/enum change** in Phases 1–2 (Decision A1) — saved projects keep loading unchanged.

## Risks

- **Over‑promising copy persists if Phase 1 ships alone.** Mitigation: step 3 explicitly softens the card text; only re‑promote per shipped phase.
- **Per‑context apps inflate output** for isolated templates. Acceptable — it's the truthful representation of "UI isolated per context"; gate strictly on `allowSharedUi === false`.
- **Phase 3 touches multiple generators + templates** (`messaging`, apps, ports/adapters). Keep it isolated behind the `rules.crossContextCalls` switch so modular‑monolith output is byte‑identical to today and the blast radius is bounded.
- **Legacy/drifted saved projects** may carry an unknown `workspaceTemplate`. The `FALLBACK_RULES` (step 2) keeps generation from throwing — verify against the Path‑4 verbatim‑preserve perimeter.

## Out of scope

- Changing the AI staged‑generation pipeline (`ExecuteStagedGenerationUseCase`) — it consumes the template only as serialized prompt context; this plan is about the deterministic wizard → manifest → sync path.
- New architectural templates beyond the existing three.
- Per‑context **API** isolation (this plan isolates UI via `allowSharedUi`; an analogous API split is a possible follow‑up, not part of these rules).

## Suggested split

- **PR 1 (Phase 1)** — rules‑as‑source‑of‑truth in `wizardToManifest` + `FALLBACK_RULES` + honest card copy + tests. Self‑contained, no output change for the three known ids; ships the honesty fix immediately.
- **PR 2 (Phase 2)** — `deriveApps` honors `allowSharedUi` (per‑context web apps) + tests. Depends on PR 1. First _visible_ differentiator.
- **PR 3+ (Phase 3)** — event‑bus and network scaffolding, likely split per boundary type (event‑bus, then network). Depends on PR 1. The full promise; largest effort.
