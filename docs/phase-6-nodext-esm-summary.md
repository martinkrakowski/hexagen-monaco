# Phase 6: NodeNext ESM Migration — Work Summary

**Status:** 📋 Deferred Follow-Up | **Priority:** Medium (Infrastructure)  
**Effort:** 4–6 hours | **Blocker For:** Node.js ESM runtime interop; sync CLI execution  
**Authority:** Remediation Phases 1–5 Closure; ADR-pending

---

## Executive Summary

The architectural remediation (Phases 1–5) is **complete and merged to main**. However, a
pre-existing TypeScript module resolution incompatibility surfaced during Phase 1 barrel
restructuring:

- **Current State:** `moduleResolution: "bundler"` + `module: "ESNext"`
- **Problem:** TypeScript outputs imports **without `.js` extensions**; Node.js ESM requires them
- **Scope:** ~560 TypeScript files need `.js` extensions on relative imports
- **Impact:** Sync CLI and ESM-based runtime fail with `ERR_MODULE_NOT_FOUND`

**Phase 6** addresses this as a **dedicated infrastructure sprint** separate from design system
remediation.

---

## Why Phase 6 Is Separate

| Item                      | Status | Detail                                               |
| ------------------------- | ------ | ---------------------------------------------------- |
| Design system remediation | ✅     | Shipped on main (Phases 1–5)                         |
| P0 blockers (4)           | ✅     | All resolved                                         |
| P1 issues (3)             | ✅     | All resolved                                         |
| Token compliance          | ✅     | 100% (75/75 violations fixed)                        |
| ESM/nodeNext migration    | 📋     | Pre-existing debt; not caused by remediation work    |
| Combined PR risk          | 🚨     | Would destabilize already-reviewed, approved changes |

**Decision:** Merge remediation PR #27 as-is; handle ESM as Phase 6 follow-up.

---

## Phase 6 Scope

### Configuration Change

```json
{
  "moduleResolution": "nodeNext", // was: bundler
  "module": "NodeNext" // was: ESNext
}
```

### Files Affected

- **~560 TypeScript files** with relative imports:
  - `packages/*/src/**/*.ts`
  - `packages/*/src/**/*.tsx`
  - `apps/*/src/**/*.ts`
  - `apps/*/src/**/*.tsx`

### Required Changes

Add `.js` extensions to all **relative imports only**:

```typescript
// ❌ Before
import { foo } from "./domain";
import type { Bar } from "../shared/types";
export * from "./project-spec/project-spec";

// ✅ After
import { foo } from "./domain.js";
import type { Bar } from "../shared/types.js";
export * from "./project-spec/index.js";
```

### Exclusions (No Changes)

- Node modules (already .js or packages)
- Absolute imports (aliases like `@hexagen/*`)
- External modules

---

## Implementation Plan

### Phase 6a: Tooling Setup (0.5 hours)

- [ ] Write robust migrator script (Node.js AST or regex-based)
- [ ] Validate on 5–10 sample files
- [ ] Ensure only relative imports are modified
- [ ] Test edge cases (complex re-exports, barrel files, etc.)

### Phase 6b: Mass Migration (2–3 hours)

- [ ] Apply migrator to all packages/ and apps/
- [ ] Verify `.js` extensions added correctly
- [ ] Spot-check 10–15 files for correctness
- [ ] Confirm no functional code changes (import paths only)

### Phase 6c: Validation & Testing (1–2 hours)

- [ ] `yarn build` — 32/32 packages (clean build)
- [ ] `yarn typecheck` — 52/52 contexts (zero errors)
- [ ] `yarn lint` — ESLint rules pass
- [ ] `yarn lint:arch` — Architectural integrity holds
- [ ] `yarn test` — 268+ tests pass (address pre-existing failures)
- [ ] `yarn workspace @hexagen/sync run cli sync --help` — CLI works

### Phase 6d: Finalization (0.5 hours)

- [ ] Commit with descriptive message
- [ ] Push to remote
- [ ] Create PR / merge gate review
- [ ] Document any edge cases or workarounds

---

## Success Criteria

✅ All 560+ files updated with `.js` on relative imports  
✅ No functional code changes (import paths only)  
✅ `yarn build` passes (32/32 packages)  
✅ `yarn typecheck` passes (52/52 contexts)  
✅ `yarn lint` passes (zero new violations)  
✅ `yarn lint:arch` passes (boundaries intact)  
✅ `yarn test` passes (268/268 tests)  
✅ Sync CLI executes successfully  
✅ NodeNext config validates import resolution at compile time

---

## Risk Assessment

| Risk                       | Likelihood | Impact | Mitigation                 |
| -------------------------- | ---------- | ------ | -------------------------- |
| Breaking imports via regex | Medium     | High   | AST-based approach; review |
| Missing edge cases         | Medium     | Medium | Pattern testing matrix     |
| Build/test failure         | Low        | High   | Full CI before commit      |
| Unintended file changes    | Low        | Medium | Read-only dry-run preview  |

---

## References

- **Detailed Phase 6 Specification:** `/docs/remediation-phase-6-esm-migration.md` (166 lines)
  - Full implementation strategy
  - Risk matrix with mitigations
  - Acceptance gates
  - Rationale for deferral
- **Remediation Completion Report:** `/docs/remediation-completion-report-2026-04-25.md`
  - "Known Limitations & Follow-Up Work" section
  - ESM root cause explanation
- **Remediation Work Plan:** `/docs/remediation-work-plan-2026-04-25.md`
  - Historical context (Phases 1–5 outcomes)

---

## Timeline

**When to Start:**

- After PR #27 merge is stable on main
- All CI gates passing cleanly
- Sync CLI validation complete
- Estimated: Next sprint or dedicated 1–2 day slot

**Duration:** 4–6 hours (1 day focused work OR 2 half-days)

**Blocking:** None (pre-existing debt; not blocking other work)

---

## Acceptance Gates

### Pre-Migration

- ✅ Migrator script written and tested
- ✅ Sample files validated
- ✅ Edge cases documented

### Post-Migration

- ✅ Build passes without errors
- ✅ Typecheck completes zero errors
- ✅ All 268+ tests pass
- ✅ Sync CLI verifies with `--help`
- ✅ Lint/arch-lint gates hold
- ✅ PR review + merge to main

---

## Key Decisions

1. **Why defer?** ESM is pre-existing infrastructure debt surfaced by Phase 1 changes, not caused by
   them. Separating concerns reduces review risk and focuses effort.

2. **Why nodeNext?** Proper TypeScript ESM support; validates import resolution at compile time
   vs. post-build script workarounds.

3. **Why ~560 files?** Monorepo scale; every relative import across all packages + apps needs
   explicit `.js` extension under NodeNext module resolution.

---

## Communication & Handoff

**For Project Managers:**

- Phase 6 is **not blocking** any current or upcoming features
- Scheduling flexibility — can be done as infrastructure sprint whenever convenient
- Estimated effort: 4–6 hours start-to-finish

**For Developers:**

- Start with `/docs/remediation-phase-6-esm-migration.md` (full spec)
- Use this summary as quick reference and task breakdown
- Script-first approach recommended (manual editing not feasible at scale)

**For Code Reviewers:**

- Review should focus on: correctness of migrator, edge case handling, and full CI validation
- Expected changes: import paths only (no logic changes)
- Commit message should reference Phase 6 ticket and rationale

---

## Next Phase Trigger

Phase 6 kicks off when:

1. ✅ PR #27 (remediation) is on main and stable
2. ✅ All CI gates passing cleanly
3. ✅ Team capacity available for 1–2 day sprint
4. ✅ Explicit go-ahead from project leadership

---

**Created:** 2026-04-25  
**Authority:** Architectural Remediation Project Closure  
**Status:** Ready for Phase 6 Initiation
