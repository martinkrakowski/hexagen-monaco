# Phase 6: ESM Module Resolution & TypeScript nodeNext Migration

**Status:** 📋 Deferred Follow-Up Ticket  
**Priority:** Medium (Infrastructure)  
**Effort Estimate:** 4–6 hours  
**Blocker For:** Node.js ESM runtime interoperability; sync CLI NodeNext validation

---

## Problem Statement

Current HexaGen Monaco configuration uses:

- `moduleResolution: "bundler"`
- `module: "ESNext"`

This configuration outputs TypeScript imports **without `.js` extensions**, which causes **runtime failures** in Node.js ESM environments.

**Root Cause:** TypeScript with `module: "ESNext"` assumes bundler-based resolution (webpack, esbuild, etc.) and does not emit required `.js` extensions for Node.js ESM direct execution.

---

## Scope

### Files Affected

- **560+ TypeScript files** across:
  - `packages/*/src/**/*.ts`
  - `packages/*/src/**/*.tsx`
  - `apps/*/src/**/*.ts`
  - `apps/*/src/**/*.tsx`

### Required Changes

1. Update `tsconfig.base.json`:

   ```json
   {
     "moduleResolution": "nodeNext",
     "module": "NodeNext"
   }
   ```

2. Add `.js` extensions to **all relative imports** across all TypeScript files:

   ```typescript
   // Before
   import { foo } from "./domain";
   import type { Bar } from "../shared/types";

   // After
   import { foo } from "./domain.js";
   import type { Bar } from "../shared/types.js";
   ```

3. **EXCLUDE** from modification:
   - Node module imports (already have .js or are packages)
   - Absolute path imports (alias-based, e.g., `@hexagen/*`)
   - External module imports

---

## Implementation Strategy

### Phase 6a: Tooling Setup (0.5 hours)

- [ ] Write robust Node.js script (or use TypeScript compiler API) to:
  - Parse imports via AST or regex
  - Identify relative imports only
  - Add `.js` extension only to local files
  - Preserve non-relative imports unchanged
- [ ] Validate script against sample files across different patterns
- [ ] Test on 5–10 files manually before mass application

### Phase 6b: Mass Migration (2–3 hours)

- [ ] Run script across all packages and apps
- [ ] Verify `.js` extensions added correctly
- [ ] Spot-check 10–15 files across different packages
- [ ] Ensure no functional code changes (only import paths)

### Phase 6c: Validation & Testing (1–2 hours)

- [ ] Run full build:
  ```bash
  rm -rf packages/*/dist .turbo node_modules/.cache
  find . -name "*.tsbuildinfo" -delete
  yarn build && yarn typecheck && yarn lint && yarn test
  ```
- [ ] Run sync CLI with nodeNext:
  ```bash
  yarn workspace @hexagen/sync run cli sync --help
  ```
- [ ] Verify all 268 tests pass
- [ ] Check for any import resolution errors or warnings

### Phase 6d: Finalization (0.5 hours)

- [ ] Commit changes with descriptive message
- [ ] Push to remote
- [ ] Create follow-up PR if needed
- [ ] Document any edge cases or workarounds

---

## Risk Assessment

| Risk                               | Likelihood | Impact | Mitigation                          |
| ---------------------------------- | ---------- | ------ | ----------------------------------- |
| Breaking imports via regex         | Medium     | High   | Use AST-based approach; spot-check  |
| Missing edge cases (aliases, etc.) | Medium     | Medium | Comprehensive pattern testing       |
| Build/test failure after changes   | Low        | High   | Full CI validation before commit    |
| Unintended file modifications      | Low        | Medium | Read-only pre-run; verify diff size |

---

## Success Criteria

- ✅ All 560+ files updated with `.js` extensions on relative imports
- ✅ No functional code changes (import paths only)
- ✅ `yarn build` passes (32/32 packages)
- ✅ `yarn typecheck` passes (52/52 contexts)
- ✅ `yarn lint` passes with no new errors
- ✅ `yarn lint:arch` passes (architectural integrity)
- ✅ `yarn test` passes (268/268 tests)
- ✅ Sync CLI works with nodeNext config

---

## Acceptance Gates

1. **Build Gate:** Clean build output, zero build failures
2. **Type Gate:** Full typecheck passes, zero errors
3. **Lint Gate:** ESLint rules pass, no new violations
4. **Arch Gate:** `yarn lint:arch` validates boundaries
5. **Test Gate:** All 268 tests pass; no regressions
6. **Runtime Gate:** Sync CLI executes successfully with NodeNext config

---

## Rationale for Deferral

This work was **deferred** from the main remediation effort (Phases 1–5) because:

1. ✅ All P0/P1 architectural issues are **resolved** in Phases 1–5
2. ✅ Design system remediation is **shipping** as specified
3. ❌ ESM is **pre-existing infrastructure debt** (not caused by remediation work)
4. 🚨 Combining ESM + remediation in single PR creates **review/testing risk**
5. ⏱️ ESM alone requires **4–6 dedicated hours** with careful validation

**Approach:** Ship remediation as PR #27 → Merge to main → Create Phase 6 as dedicated follow-up

---

## Related Documentation

- Remediation Completion Report: `/docs/remediation-completion-report-2026-04-25.md`
- Remediation Work Plan: `/docs/remediation-work-plan-2026-04-25.md`
- TypeScript Configuration: `tsconfig.base.json`
- Current Architecture: `.architecture/manifest.yaml`

---

**Created:** 2026-04-25  
**Authority:** Architectural Remediation Project Closure  
**Status:** Awaiting Approval for Phase 6 Initiation
