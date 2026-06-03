# ADR-0040: Driver Context Type is LLM-Emittable

**Date:** 2026-06-03
**Status:** Accepted
**Type:** Architecture
**Extends:** ADR-0009 (driver-context-wiring-strategy)

## Context

`"driver"` is one of the five canonical bounded-context types in
`@hexagen/shared` (`BOUNDED_CONTEXT_TYPES`), accepted by every validation schema
since the single-sourcing work (#197 → #207). ADR-0009 established the driver
concept — the hexagonal **outer ring**: contexts/apps that integrate external
systems by implementing ports owned by other contexts.

But the AI generation prompts were inconsistent about whether the LLM may assign
`type: "driver"`: `generate-manifest.prompt.ts` listed `driver` in one rule yet
omitted it in another, and the classify prompt
(`classify-context-type.prompt.ts`) defined only `core`/`supporting`/`generic`/
`shared-kernel`. So the schema accepted `driver` but the model was never taught
it. PR B (the prompt-consistency phase of the bounded-context-type remediation
plan) could not proceed without settling the intent.

## Decision

**`"driver"` is LLM-emittable.** The AI classify/generate flow MAY assign
`type: "driver"` to a bounded context, and the prompts are made consistent around
the full five-value set.

To make it teachable, the classify prompt's `Definitions:` block gains a `driver`
entry:

> **driver** — Outer-ring context that integrates an external system or delivery
> channel (UI, API, CLI, storage) by implementing ports owned by other contexts.

(Working definition, drawn from ADR-0009; refine as the concept matures.)

## Consequences

- All generation/classification prompts (`classify-context-type`,
  `generate-topology`, `generate-manifest`, `convert-loose-spec`) enumerate the
  same five-value set, and `generate-manifest`'s internal contradiction is
  resolved.
- No schema change — schemas already accept `driver`; this decision is purely
  about what the prompts teach and permit.
- The model may now produce `driver` contexts from a description; output quality
  depends on the definition above, which should be revisited if the model
  over- or under-applies it.

## Alternatives considered

- **`driver` as config-only** (set via structured-config import / manual edit,
  never classified): rejected — ADR-0009 treats driver as a first-class
  architectural role and one prompt rule already emitted it, so config-only would
  mean removing a working capability and auditing UI surfaces to hide `driver`.

## References

- ADR-0009 (driver-context-wiring-strategy)
- `docs/planning/bounded-context-type-enum-consolidation.md` (PR B)
- `@hexagen/shared` — `BOUNDED_CONTEXT_TYPES`
