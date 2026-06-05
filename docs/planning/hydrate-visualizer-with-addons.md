# Hydrate the Visualizer with Add-On Selections

**Status:** **Build-ready — Q3 resolved (annotate-only); mapping-data foundation started.** The three open questions are settled (see [Resolution](#resolution--the-three-open-questions-settled)). Remaining build: the mapping data (schema + per-template `provides`/`scope` — _in progress_) → thread `addOnsAnswers` into the canvas → the compass join + rendering.
**Sequenced after** the template-content expansion (now complete: `mcp-server` #226 + `mcp-server-http` #227). The two were independent — the materialization path is generic, so template content needed zero visualizer work.

## Problem

The wizard's add-on selections (`addOnsAnswers`) reach the **code view** (materialized files + notices — shipped #211–#223) but **not the architecture visualizer**. The hexagon canvas is built purely from the manifest — verified: `apps/web/features/hexagon-canvas` and `@hexagen/visualization` have **zero** add-on / `addOnsAnswers` references. So the user picks add-ons and the diagram doesn't change.

## Canvas audit (this gates the visual treatment — do it first)

The canvas **already renders adapter nodes** in a per-context **compass** layout: `packages/visualization/src/infrastructure/adapters/hexagonal-map-generator/generate-compass-nodes.ts` maps each context's manifest adapter fields to positioned nodes (`persistenceAdapter` → East, `messagingAdapter`/`telemetryProvider` → South, `uiFramework` → West, `apiFramework`/`infrastructureTarget` → North) emitted with `type: "adapter"`. The node vocabulary is `HexagonNodeType = bounded-context | entity | port | use-case | adapter | peer | group | inner`.

**Implication:** an add-on that _is_ an adapter (bullmq→messaging, supabase→persistence, Adobe→external-API) maps onto an **existing** node type and slot. The honest treatment is to **populate/annotate the existing compass adapter slot**, not invent a badge or a new node type — the user sees the add-on _completing_ the hexagon, not annotating it.

## Decisions

1. **Visual treatment (keyed off the audit).** Adapter-type add-ons → populate/annotate the matching context's existing compass **adapter** node, styled distinctly (add-on-provided vs core) with hover→source and jump-to-files. A **badge** is only the fallback for add-ons with **no** existing node mapping. Rejected: a separate add-on **layer** (implies add-ons are architectural peers of contexts — they aren't) and **package nodes** (new visual vocabulary, no mental-model payoff).
2. **Cross-cutting split — two buckets, not one.**
   - Shared **domain** primitives (value objects, events, shared ports) → the auto **shared-kernel** context (`scope: "shared"`).
   - Infra cross-cutting (docker, error-handling, telemetry, observability) → a project-level **"platform zone"** (`scope: "project"`): a thin strip / chip **outside** the context hexagons. Explicitly **not** a sixth context type — must not be mistaken for one.
3. **Mapping is authoritative data, never path-inference.** Each add-on template declares `provides: "<capability>"` (e.g. `"messaging.out-adapter"`) + `scope: "context" | "shared" | "project"`. The canvas **resolves** context-scoped add-ons against the **same manifest adapter fields the compass already uses** (`messagingAdapter` / `persistenceAdapter` / `telemetryProvider`) — no parsing of `src/infrastructure/...` directory conventions. Authoritative on both sides of the join.

## Resolution — the three open questions (settled)

**Q3 — join semantics → ANNOTATE-ONLY (option 1).** The selection overlays the canvas; the architecture manifest is **never mutated**. Decisive framing: the project's source of truth is **already** manifest + add-on selections _combined_, not the manifest alone — `addOnsAnswers` persists in IndexedDB (#221), travels in the export payload (#222), and the code view materializes add-on outputs alongside core files. So an empty `messagingAdapter` field with a selected BullMQ add-on is **not** lost data — the selection is recorded in its own durable, portable layer. Annotate-only renders the two layers together, which is _coherent_ (not misleading), keeps `manifest = architectural intent` clean, and needs no confirmation UX or mutation risk. Options 2 (annotate-and-propose) and 3 (auto-write the field) are rejected: their only advantage — reconciling manifest+canvas — is moot once the selection layer is the recognized second source of truth, and 3 additionally blurs "what I designed" vs "what a template filled in."

**Q1 — multi-match → show on ALL matching contexts.** A pure overlay following the compass's existing per-context rendering; no target-picker UX.

**Q2 — field absence → ADD AN OVERLAY SLOT** (do **not** silently skip). The whole point is that the user picked an add-on without hand-setting the adapter field; the diagram must still show it. Manifest stays untouched.

## Acceptance criteria (correctness, not polish)

- **AC-1 — Layer distinction is load-bearing.** Add-on-provided adapter nodes **MUST** be visually distinct from manifest-declared ones, with a **legend** and **hover attribution** ("provided by the `<id>` add-on"). This is what makes "two layers shown together" honest rather than a diagram that contradicts the manifest — a **correctness requirement**, not styling polish. A build where the two are indistinguishable does **not** satisfy this workstream.
- **AC-2 — Overlap reconciliation.** When **both** the manifest field is set **and** a matching add-on selection exists for the same slot, render a **single node, annotated as add-on-provided** — never double-draw. This is the one point where the two layers touch, and it needs the defined rule.
- **AC-3 — Manifest is never written** from a selection (the Q3 = annotate-only invariant).

## Mapping (authoritative data — Decision 3; being built)

Each add-on declares `provides` + `scope` on its template manifest (hand-authored schema `packages/template-engine/src/domain/template-manifest.ts`; both fields land via the validator, and they are a pair — half-specified mapping fails fast). Context-scoped capabilities resolve against the compass adapter fields; project-scoped add-ons render in the platform zone (Decision 2). First-pass data (this workstream's opening step):

| Template            | `provides`                | `scope`   | Join target                                                        |
| ------------------- | ------------------------- | --------- | ------------------------------------------------------------------ |
| `bullmq`            | `messaging.out-adapter`   | `context` | `messagingAdapter` (South)                                         |
| `supabase`          | `persistence.out-adapter` | `context` | `persistenceAdapter` (East)                                        |
| `llm-adapter`       | `llm.out-adapter`         | `context` | external-integration / badge fallback (no dedicated compass field) |
| `docker`            | `platform.container`      | `project` | platform zone                                                      |
| `error-handling`    | `platform.error-handling` | `project` | platform zone                                                      |
| `eslint-no-console` | `platform.lint`           | `project` | platform zone                                                      |

Adobe family + auth providers follow.

## Sequencing

1. ~~Template content~~ — **done** (#226, #227).
2. **Mapping data** (schema + per-template `provides`/`scope`) — **in progress** (this PR: schema + the priority context-scoped + project-scoped templates above; Adobe/auth follow).
3. Thread `addOnsAnswers` into the visualizer (the canvas builds purely from the manifest today; the code-view path is the model to follow). Also extend the **web** manifest bundle to carry `provides`/`scope` — `apps/web/scripts/generate-template-questions.ts` currently picks only `id/name/description/requires/conflicts`.
4. Compass join + rendering per the Decisions and Acceptance criteria above.
