# Phase 7 — Composition-Root Purification

**Workstream:** Core Implementation  
**Phase:** 7

## Goal

Complete the extraction of kernel and probabilistic logic from `apps/web/app/lib/` and `apps/web/app/config/` into their proper owning packages.

This is the final major step to enforce the "app layer contains only browser utilities + composition root wiring" rule.

## Major Extractions

- Prompt-related logic → `prompt-compiler`
- Model configuration and recommendations → `local-llm`
- Layout engine logic → `layout-engine`
- Wizard mapping and composition logic → `wizard-orchestration`
- Enforcement tooling (scripts + ESLint rules) to prevent regression

## Post-Phase 7 Target State for `app/lib/`

Only the following categories are considered legitimate:

- Browser-only utilities (download, fetch, language, tree utils, etc.)
- Persisted state helpers
- Composition root wiring (`wire.ts` and related)

## Enforcement

- Extended `validate-ui-boundary.sh` script
- Root ESLint `no-restricted-imports` rules
- Updated documentation in `apps/web/README.md`

## Status

This phase was designed to run in parallel with Phase 5/6 where dependencies allowed.

For the full original migration table (7.1–7.13) and target state of `app/lib/`, see the historical combined Phase 3–7 Execution Plan.
