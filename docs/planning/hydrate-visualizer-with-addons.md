# Hydrate the Visualizer with Add-On Selections

**Status:** Design note — decisions converging; **three open questions** to resolve before build.
**Sequenced after** the template-content expansion (the two are independent — the materialization path is generic, so template content needs zero visualizer work). Build gated on the open questions below.

## Problem

The wizard's add-on selections (`addOnsAnswers`) reach the **code view** (materialized files + notices — shipped #211–#223) but **not the architecture visualizer**. The hexagon canvas is built purely from the manifest — verified: `apps/web/features/hexagon-canvas` and `@hexagen/visualization` have **zero** add-on / `addOnsAnswers` references. So the user picks add-ons and the diagram doesn't change.

## Canvas audit (this gates the visual treatment — do it first)

The canvas **already renders adapter nodes** in a per-context **compass** layout: `packages/visualization/src/infrastructure/adapters/hexagonal-map-generator/generate-compass-nodes.ts` maps each context's manifest adapter fields to positioned nodes (`persistenceAdapter` → East, `messagingAdapter` → South, …) emitted with `type: "adapter"`. The node vocabulary is `HexagonNodeType = bounded-context | entity | port | use-case | adapter | peer | group | inner`.

**Implication:** an add-on that _is_ an adapter (bullmq→messaging, supabase→persistence, Adobe→external-API) maps onto an **existing** node type and slot. The honest treatment is to **populate/annotate the existing compass adapter slot**, not invent a badge or a new node type — the user sees the add-on _completing_ the hexagon, not annotating it.

## Decisions

1. **Visual treatment (keyed off the audit).** Adapter-type add-ons → populate/annotate the matching context's existing compass **adapter** node, styled distinctly (add-on-provided vs core) with hover→source and jump-to-files. A **badge** is only the fallback for add-ons with **no** existing node mapping. Rejected: a separate add-on **layer** (implies add-ons are architectural peers of contexts — they aren't) and **package nodes** (new visual vocabulary, no mental-model payoff).
2. **Cross-cutting split — two buckets, not one.**
   - Shared **domain** primitives (value objects, events, shared ports) → the auto **shared-kernel** context.
   - Infra cross-cutting (docker, error-handling, telemetry, observability) → a project-level **"platform zone"**: a thin strip / chip **outside** the context hexagons. Explicitly **not** a sixth context type — must not be mistaken for one.
3. **Mapping is authoritative data, never path-inference.** Each add-on template declares `provides: "<capability>"` (e.g. `"messaging.out-adapter"`) + `scope: "context" | "shared" | "project"`. The canvas **resolves** context-scoped add-ons against the **same manifest adapter fields the compass already uses** (`messagingAdapter` / `persistenceAdapter` / …) — no parsing of `src/infrastructure/...` directory conventions. Authoritative on both sides of the join.

## Open questions (must be explicit; resolve before build)

- **Q1 — Multi-match.** A context-scoped add-on whose capability matches **multiple** contexts (e.g. two contexts both set `messagingAdapter`): does it appear on **all** matches (consistent with the compass's per-context rendering — the likely default), or does the user choose a target?
- **Q2 — Field absence.** A context with **no** matching adapter field: does the add-on **silently not attach** (consistent with the compass's `if (ctx.messagingAdapter)` conditional — the likely default), or is that a configuration error to surface?
- **Q3 — The join semantics (surfaced by the audit; the hard one — it gates Q1/Q2).** Add-on selection (`addOnsAnswers`) and the context adapter fields (`ctx.messagingAdapter`) are **separate data today**, so the question isn't only _which_ contexts match — it's **what the match does to the manifest**. Three candidates, by increasing coupling:
  1. **Annotate-only** — selection overlays the canvas (add-on shown in the matching slot, or a new slot where none exists); the **manifest is untouched** and the adapter field stays empty until the user sets it explicitly. Simplest and safest; cost: the diagram can show an adapter the manifest doesn't record (overlay ≠ recorded intent).
  2. **Annotate-and-propose** — same overlay **plus a user-confirmed action** to write the field, so canvas and manifest are reconciled deliberately.
  3. **Auto-write the adapter field** — selection mutates the manifest directly. ⚠️ Significant side effect: the manifest currently represents the user's **architectural intent**, so auto-filling it blurs "what I designed" vs. "what a template filled in" — the most surprising option and the hardest to reverse cleanly. **Not** a neutral default.

  Lean to **1 or 2** (keep manifest = intent clean); treat **3** as the path to avoid absent a strong reason. This rule decides whether Decision 1 annotates vs. adds nodes — settle it first.

## Sequencing

Template content first (low design risk, immediate value, no visualizer dependency). This workstream follows, and its build's **step 1 is the Q3 resolution rule** — everything visual depends on it.
