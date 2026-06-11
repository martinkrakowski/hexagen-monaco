# ADR-0042: Cloud-First LLM Execution and Tandem Mode Removal

**Status:** Accepted
**Date:** 2026-06-12
**Authors:** Architecture Co-pilot, Human Architect
**Related to:** ADR-0021 (anti-corruption layers), ADR-0031 (pipeline-phased-implementation), ADR-0032 (pipeline-architecture)

---

## Context

Until June 2026 the platform treated LLM execution as a three-way choice:
**local** (WebLLM/WebGPU in-browser inference), **cloud** (provider API via the
server), and **tandem** (an interleaved local+cloud mode with its own bounded
context, `tandem-execution`, interception UI, and configuration surface).
Strategy resolution defaulted to `auto`, which preferred a loaded local model.

Three forcing events changed the picture:

1. **The production pipeline flip (2026-06-11).** Staged manifest generation
   moved to the full 0→6 pipeline on a single cloud provider
   (`inception:mercury-2`, with a gpt-4o stage-1 refiner) for every request.
   Cloud generation became the product's primary, measured path — server total
   ~16.5s for a representative 7-context import.
2. **The 5-minute-import incident.** The same import took ~5 minutes for the
   human architect because `auto` ran a loaded WebLLM model in-browser first
   and then *silently* fell back to cloud. The strategy resolver was making an
   architecture-level routing decision invisibly, with a 20× latency penalty.
3. **Tandem mode had no remaining role.** With cloud as the quality and
   latency baseline, interleaving local output into cloud flows added a
   bounded context, an interception modal, configuration state, and
   cross-context `allowed_imports` surface — while producing strictly worse
   output than the cloud path it interrupted.

The resulting overhaul shipped as a seven-PR wave
(plan: `docs/planning/llm-execution-and-free-tier-overhaul.md`, PRs
#303, #305–#311). This ADR records the architectural decisions; the UX and
telemetry changes that rode along (model-identity chips in generation
telemetry, removal of the duplicated approve-manifest screen) are
implementation detail, documented in their PRs.

## Decision

1. **Cloud is the default execution path.** The `auto` strategy resolves
   cloud-first. Falling back is *honest*: any switch away from the requested
   path surfaces in the UI rather than happening silently.
2. **Local execution is explicit opt-in.** A persisted three-state engine
   selection (`auto` / `cloud` / `local`) distinguishes "user chose local"
   from "auto resolved to local"; choosing local triggers a pre-generate
   warning. Local remains fully supported — it is a privacy/offline feature,
   not a performance feature.
3. **Tandem mode is removed entirely.** The UI/hooks layer (PR-5a, #310) and
   the `packages/tandem-execution` workspace package with its bounded context
   (PR-5b, #311) are deleted. The architecture topology drops from 35 to 34
   bounded contexts; `@hexagen/tandem-execution` is pruned from four
   `allowed_imports` lists in `linter-config.yaml`.
4. **Single cloud provider for generation.** Production generation runs on
   `inception:mercury-2` (plus the gpt-4o stage-1 refiner). The upcoming
   free-tier work (plan PR-6) standardizes chat/Q&A on the same provider —
   one API key, one quota surface.

## Consequences

- **Decision-trail note:** the gate-3b ADR lived *inside* the
  `tandem-execution` context directory and was deleted with it (it documented
  an implementation decision internal to the deleted context). It remains in
  git history; the general ACL principles it leaned on live in ADR-0021. This
  ADR is now the discoverable record of why no tandem context exists.
- The strategy resolver no longer has a silent-degradation path; latency
  regressions of the 5-minute-import shape are structurally impossible
  without a visible UI state.
- Single-provider concentration is accepted risk: a mercury-2 outage degrades
  generation until the key/model is swapped. Mitigations: the
  `STAGED_GENERATION_PIPELINE=stub` rollback lever (until the stub's planned
  deletion) and BYOK for users with their own cloud keys.
- The shared package state machine still models a `preview` state and the
  stub pipeline still exists; both are scheduled for the A4 cleanup, not this
  wave.
- Free-tier quota enforcement (PR-6: anonymous-session + per-IP limits,
  SQLite-backed) becomes tractable precisely because all free traffic flows
  through one provider seam.

## Rejected Alternatives

- **Keep tandem behind a flag.** Rejected: the cost was a whole bounded
  context plus governance surface, not a code path; a flag preserves all of
  it for a mode with no quality argument.
- **Two-state engine selection (cloud/local).** Rejected: collapsing `auto`
  would either break the no-local-model first-run experience or reintroduce
  silent resolution; the three-state store keeps "auto resolved to local"
  distinguishable and gateable.
- **Relocate the gate-3b ADR instead of deleting it.** Rejected: it documents
  internals of a context that no longer exists; relocation would imply the
  decision still binds something.

## References

- Plan: `docs/planning/llm-execution-and-free-tier-overhaul.md` (PR #304)
- PRs: #303 (truthful model badges), #305 (cloud-first auto), #306
  (model-identity telemetry), #307 (explicit local override + warning),
  #308/#309 (approve-screen dedup), #310/#311 (tandem removal)
