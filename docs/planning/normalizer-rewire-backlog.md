# Normalizer / Stage-Route Rewire — Backlog

**Status:** Parked. Groundwork committed (`prep/token-plane-groundwork`); the rest waits on the rewire being scoped.
**Date:** 2026-06-09
**Parent:** Outcome of the 2026-06-09 prompt-governance arc. Live-pipeline facts: see the `ai_manifest_staged_pipeline` agent memory. Methodology caveat: see `feedback_verify_codepath_live` agent memory.

## Context (one paragraph)

A multi-review prompt-hardening pass targeted `ExecutePromptNormalizationUseCase` / `STAGE0_NORMALIZATION_SYSTEM_PROMPT` as "the wired normalizer." It has **zero production construction sites** — the live AI-manifest path runs an inline-prompt stub (`ExecuteStagedGenerationUseCase`); the import path wires per-stage stages 3–6 only. So the normalizer hardening was prep for a future pipeline, not a production fix. Only the clean, direction-agnostic groundwork was banked (token single-sourcing in `architecture-contract.ts`; `PLANE_NAMES` in `project-configuration`). Nothing below is urgent; nothing is on fire.

_Full reasoning chain behind this backlog — including the self-corrections that reframed the work — is in the session thread doc `hexagen-normalizer-integration-thread.md` (saved locally to the author's Desktop; not in-repo). Worth consulting if a decision here is ever questioned._

## 1. Gating item — unlocks everything normalizer-related

**Stage-route rewire:** replace the inline-prompt stub with the fuller per-stage pipeline / richer `domain/prompts/`. This is the only item that converts the parked groundwork into user-visible value (manifest quality). Until it's scoped, §2 stays parked.

## 2. Parked — gated behind the rewire (deferred T2)

- Wire `ExecutePromptNormalizationUseCase` in (or decide the rewire supersedes it).
- **T2b / P2:** thread `architectureContext` via **constructor injection** through the 3 levels; greenfield sources the static contract from `architecture-contract.ts` + `PLANE_NAMES` (already banked).
- **P3:** consume `complianceCheck` / `errorCorrectionsApplied` into `StageTelemetry` (non-blocking); a blocking HITL gate is a _separate_ later step.
- Smoke test at the **loading seam** (not fixture-only) proving `<architecture>` is non-empty.
- Option-B relocation of the canonical normalizer into `agentic-interaction`. (The duplicate `CENTRAL_*` orphan is already gone.)

## 3. Independent — can proceed anytime (verify-live first)

- **Context-name ban reconciliation:** the three lists in `architecture-contract.ts` contradict each other — land `stripe-payments` / `api-gateway` / `user-database` as failing tests, then fix. Behavior change + intentional prompt-snapshot rebaseline + HITL gate. Note: only the Stage-6 R01 list is live today (Stage-2 prompt + deterministic filter are dead), so this may be most efficient folded into the rewire.
- **P7:** `README.md:139` claims Stage-3 escalates to `gpt-4o`; config ships `escalationModel: undefined`.
- **P9:** `escapeXml` missing in `generate-adapters` + `classify-context-type` prompts.
- **P12:** `yaml-editing-disciplines.md` indentation example cites `layers:` / `NodeKind`; manifest uses `plane:` / `file:`.

## 4. Suspect — re-verify the premise before investing

> **Step zero (do this first):** grep construction/call sites to confirm the path is live before treating any item here as a production concern. This arc's central error was skipping that check.

- **P4 — remediation hardening** (`holistic-manifest-repair`, `fix-manifest-violation`: hardcoded `"gpt-4"`, no governance gate).
- **P5 — MCP governance parity** (`manifest-generation.adapter.ts` uses `validateDraft`, not R01–R18; writes with no lint:arch/HITL gate).
- **P6 — dead `escalationConfig`** in 6 use-cases — several _are_ the dead per-stage classes, so likely "dead param in dead code."

## 5. Optional / low value

- Prompt versioning (`NORMALIZER_PROMPT_VERSION` → `prompt-cache-key` + telemetry). Cosmetic until a cache collision actually bites.
