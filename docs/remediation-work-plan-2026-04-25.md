# HexaGen Monaco — Architectural Remediation Work Plan

**Date:** April 25, 2026  
**Authority:** Architectural Remediation Report (2026-04-24) + Integrated Audit Findings  
**Total Scope:** 20–29 hours | 5 Phases | 3 Sub-Agent Teams | 23 Work Items

---

## Executive Summary

This plan remediates **4 critical blockers** and **3 high-severity issues** identified in the integrated audit:

### Critical Blockers (P0)

1. **Shared kernel exports context-owned schemas** (7 types must move to project-configuration)
2. **Transaction system REM not integrated** (parameters accepted but never used)
3. **Zod schema generator uses type-sniffing only** (no deterministic contract validation)
4. **67 arbitrary Tailwind values bypass token system** (token compliance broken)

### High-Severity Issues (P1)

5. Linter coverage gap: 2 unmonitored packages
6. 4 aspirational packages lack runtime responsibility
7. Hardcoded colors (blue, emerald, violet, sky, yellow) break dark mode

---

## Global Governance Block

### Authority & Constraints

- **Master Authority:** Architectural Remediation Report (2026-04-24) + Integrated Audit (2026-04-25)
- **Non-Negotiable Rules:**
  - P0 blockers completed before P1 starts
  - All changes validated: `yarn build && yarn typecheck && yarn lint && yarn lint:arch` pass
  - All tests pass: `yarn test` (no skips, no timeouts)
  - No commits until phase gate passes
  - Determinism: All generated code must be testable, reproducible, reviewable

### Escalation Path

- If any phase produces build failures → **HALT immediately**; do not cascade
- If any sub-agent encounters ambiguity → **Escalate to orchestrator**; do not proceed
- If any gate fails → **Revert that phase**; do not proceed to next phase

---

## Sub-Agent Role Definitions

| Role                     | Responsibility                                                        | Scope                                          | Sub-Tasks |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------- | --------- |
| **Domain Worker**        | Move context-owned schemas; update imports; validate ownership        | packages/shared → project-configuration        | 4 items   |
| **Kernel Worker**        | Implement REM integration; redesign schema generator port             | transaction-system, prompt-compiler, local-llm | 6 items   |
| **Design System Worker** | Create linter rules; refactor 6 violation files; add component tokens | @hexagen/ui, 43+ feature files, eslint config  | 6 items   |
| **Manifest Worker**      | Add unmonitored packages to manifest; freeze aspirational packages    | .architecture/manifest.yaml, FROZEN.md         | 4 items   |
| **QA/Gate Worker**       | Run full build; verify acceptance criteria; confirm zero regressions  | Entire monorepo                                | 3 items   |

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: Shared Kernel Repatriation (5-7h)                      │
│ Domain Worker                                                    │
│                                                                  │
│ ├─ Move WizardData family from shared → project-configuration   │
│ ├─ Update 9 transitive importers (visualization, sync, etc.)    │
│ └─ GATE: yarn build + typecheck + lint:arch pass                │
└────────────────────────────────┬────────────────────────────────┘
                                 │ (Gate = Pass)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: AI Pipeline & Determinism (6-8h)                       │
│ Kernel Worker                                                    │
│                                                                  │
│ ├─ Implement REM in transaction-system                          │
│ ├─ Redesign Zod schema generator port                           │
│ ├─ Delete orphaned compiled-prompt.adapter.ts                   │
│ └─ GATE: yarn build + typecheck + lint:arch + test pass         │
└────────────────────────────────┬────────────────────────────────┘
                                 │ (Gate = Pass)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: Token Compliance & Design System (8-12h)               │
│ Design System Worker                                            │
│                                                                  │
│ ├─ Create ESLint rule for arbitrary Tailwind values             │
│ ├─ Refactor 6 highest-violation files                           │
│ ├─ Add component-level tokens (spacing, sizing)                 │
│ ├─ Fix hardcoded colors (blue, emerald, etc.)                   │
│ ├─ Remove inline styles from canvas components                  │
│ └─ GATE: yarn lint (plugin passes) + build pass                 │
└────────────────────────────────┬────────────────────────────────┘
                                 │ (Gate = Pass)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: Package Manifest & Lifecycle (1-2h)                    │
│ Manifest Worker                                                 │
│                                                                  │
│ ├─ Add ai-pipeline & eslint-plugin-ui to manifest               │
│ ├─ Create FROZEN.md for transaction-system                      │
│ ├─ Create FROZEN.md for architectural-enforcement               │
│ ├─ Create FROZEN.md for code-generation                         │
│ ├─ Delete ai-pipeline directory (orphaned)                      │
│ └─ GATE: yarn lint:arch (full coverage pass)                    │
└────────────────────────────────┬────────────────────────────────┘
                                 │ (Gate = Pass)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 5: Final Build Validation (0.5h)                          │
│ QA/Gate Worker                                                  │
│                                                                  │
│ ├─ yarn build && yarn typecheck && yarn lint && yarn lint:arch  │
│ ├─ yarn test (all 268 tests pass)                               │
│ ├─ Verify 0 regressions from baseline audit                     │
│ └─ GATE: All checks pass → READY FOR MERGE                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## PHASE 1: Shared Kernel Repatriation (5–7 hours)

### Objective

Move context-owned schemas out of `@hexagen/shared`, restoring it to true cross-cutting primitives only.

### 1.1 Inventory & Analysis

**Sub-task:** Domain Worker | **Estimate:** 0.5h

- Read `packages/shared/src/index.ts` (current exports)
- Read `packages/shared/src/domain/wizard-data.ts` (7 types to move)
- Read `packages/project-configuration/src/schema.ts` (target location)
- Document current import sites (9 packages transitively depend)

**Deliverable:** Migration checklist with 7 types + 9 importers listed

---

### 1.2 Move WizardData Family to project-configuration

**Sub-task:** Domain Worker | **Estimate:** 1–1.5h

**Files to edit:**

- `/packages/project-configuration/src/index.ts` (add re-exports)
- `/packages/project-configuration/src/schema.ts` (add type definitions if missing)
- `/packages/shared/src/index.ts` (remove 7 exports)
- `/packages/shared/src/domain/wizard-data.ts` (delete file or mark deprecated)

**Types to move:**

- `WizardData`
- `WizardGovernance`
- `ExternalContext`
- `BoundedContext`
- `ContextRelationshipType`
- `DomainEventRef`
- `PeerMapping`

**Acceptance Criteria:**

- ✅ All 7 types accessible from `@hexagen/project-configuration`
- ✅ No imports of these types from `@hexagen/shared` remain
- ✅ `yarn build` passes

---

### 1.3 Update Transitive Importers

**Sub-task:** Domain Worker | **Estimate:** 2–2.5h

**Packages to update import paths:**

1. `packages/visualization` (3 files: hexagonal-map-generator adapters)
2. `packages/sync`
3. `packages/web-driver`
4. `packages/prompt-compiler`
5. `packages/ui-projection-compiler`
6. `packages/local-llm`
7. `apps/web`
8. `packages/project-generation`
9. Any others found via grep

**Action per package:**

1. Search: `import.*from.*@hexagen/shared.*\(WizardData|BoundedContext|...)`
2. Replace with: `import.*from.*@hexagen/project-configuration`
3. Verify build still passes

**Deliverable:** Updated imports; no dead re-exports in shared

---

### 1.4 Consolidate ProjectSpecification → ProjectSpec

**Sub-task:** Domain Worker | **Estimate:** 0.5–1h

**Issue:** Two competing representations

- `shared/domain/project-specification.ts` (raw TS interface) — **DEPRECATED**
- `project-configuration/src/schema.ts` (Zod + canonical) — **CANONICAL**

**Action:**

1. Find all imports of `ProjectSpecification` from shared
2. Replace with `ProjectSpec` from project-configuration
3. Delete `packages/shared/src/domain/project-specification.ts`
4. Update `packages/shared/src/index.ts` to remove export

**Acceptance Criteria:**

- ✅ Zero imports of `ProjectSpecification` from shared remain
- ✅ `ProjectSpec` is single source of truth
- ✅ `yarn build && yarn typecheck` pass

---

### PHASE 1 GATE

**Commands:**

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test
```

**Success Criteria:**

- ✅ All package boundary checks pass
- ✅ No new violations introduced
- ✅ All 268 tests pass
- ✅ Lint: Arch is fully compliant

---

## PHASE 2: AI Pipeline & Determinism (6–8 hours)

### Objective

Implement REM (Runtime Execution Model) in transaction system; redesign Zod schema generator to use compiled contracts.

### 2.1 Analyze Current Transaction System Architecture

**Sub-task:** Kernel Worker | **Estimate:** 0.5h

**Read:**

- `/packages/transaction-system/src/application/use-cases/execute-transaction.use-case.ts`
- `/packages/transaction-system/src/infrastructure/adapters/in-memory-transaction-manager.adapter.ts`
- `/packages/transaction-system/src/application/ports/in/transaction-manager.port.ts`

**Deliverable:** Architecture document describing REM parameter flow

---

### 2.2 Extend TransactionManagerPort to Accept & Store REM

**Sub-task:** Kernel Worker | **Estimate:** 1–1.5h

**Files to edit:**

- `/packages/transaction-system/src/application/ports/in/transaction-manager.port.ts` (add REM + lineage to port signature)
- `/packages/transaction-system/src/infrastructure/adapters/in-memory-transaction-manager.adapter.ts` (implement REM storage + validation)

**Changes Required:**

1. Extend `TransactionManagerPort.begin()` signature:

   ```typescript
   begin(
     intentId: string,
     metadata: Record<string, unknown>,
     rem?: RuntimeExecutionModel,           // NEW
     lineage?: string[]                      // NEW
   ): Promise<SpeculativeTransaction>;
   ```

2. Implement lineage validation: check prior intent IDs exist
3. Store REM for conflict detection in later phases
4. Add unit tests for REM storage + lineage chain

**Acceptance Criteria:**

- ✅ Port accepts structured REM + lineage
- ✅ `InMemoryTransactionManager` stores both
- ✅ Unit tests verify storage + validation
- ✅ `yarn build && yarn typecheck` pass

---

### 2.3 Implement Conflict Detection in Speculative State

**Sub-task:** Kernel Worker | **Estimate:** 1–1.5h

**Files to edit:**

- `/packages/transaction-system/src/domain/model/speculative-transaction.ts` (add conflict detection)
- `/packages/transaction-system/src/infrastructure/adapters/in-memory-transaction-manager.adapter.ts` (integrate conflict check)

**Changes Required:**

1. Add method: `SpeculativeTransaction.detectConflicts(rem: RuntimeExecutionModel): ConflictSet`
2. Implement basic conflict detection: if REM specifies state X and current state ≠ X, mark conflict
3. Add test covering conflict scenario

**Acceptance Criteria:**

- ✅ Speculative state can detect conflicts vs. REM
- ✅ Lineage chain is validated before allowing transaction
- ✅ Unit tests pass
- ✅ `yarn build && yarn typecheck` pass

---

### 2.4 Redesign Zod Schema Generator Port

**Sub-task:** Kernel Worker | **Estimate:** 1–1.5h

**Current Problem:**

- Port accepts raw `exampleData` only
- Adapter uses runtime type inference
- No governance validation

**New Design:**

1. Introduce `CompiledSchemaContract` parameter
2. Extend `GenerateZodSchemaRequest`:

   ```typescript
   export interface GenerateZodSchemaRequest {
     name: string;
     description: string;
     exampleData: unknown; // Keep for backwards compat
     compiledContract?: CompiledSchemaContract; // NEW
     governance?: GovernanceRules; // NEW
   }
   ```

3. Update `RRPZodSchemaGeneratorAdapter`:
   - If `compiledContract` provided, use it as authority (deterministic)
   - Else fall back to type-sniffing (legacy, non-deterministic)
   - Validate example data against contract before returning schema

**Files to edit:**

- `/packages/prompt-compiler/src/application/ports/in/generate-zod-schema.port.ts` (extend port)
- `/packages/prompt-compiler/src/infrastructure/adapters/rrp-zod-schema-generator.adapter.ts` (implement new logic)

**Acceptance Criteria:**

- ✅ Port accepts `CompiledSchemaContract` as optional parameter
- ✅ If provided, adapter uses it as deterministic authority
- ✅ Example data validated against contract before schema returned
- ✅ Unit tests cover both paths (compiled contract present/absent)
- ✅ `yarn build && yarn typecheck && yarn test` pass

---

### 2.5 Wire REM & Compiled Contracts into App

**Sub-task:** Kernel Worker | **Estimate:** 0.5–1h

**Context:** Current state:

- `apps/web/app/lib/wire.ts` instantiates services but doesn't pass REM
- `apps/web/features/llm-driver/` constructs LLMRequest directly

**Action:**

1. Update wire.ts to pass REM context when invoking transaction executor
2. Verify no breaking changes to existing call sites
3. No changes to UI-side LLMRequest construction yet (Phase 3 will wrap it)

**Acceptance Criteria:**

- ✅ Transaction system wire-up ready for REM injection
- ✅ No breaking changes to existing call sites
- ✅ `yarn build && yarn typecheck` pass

---

### 2.6 Delete Orphaned compiled-prompt.adapter.ts

**Sub-task:** Kernel Worker | **Estimate:** 0.25h

**Action:**

1. Delete `/packages/local-llm/src/infrastructure/adapters/compiled-prompt.adapter.ts` (67 lines, never wired)
2. Verify no imports of this file remain
3. Update `packages/local-llm/src/index.ts` if it re-exports this

**Acceptance Criteria:**

- ✅ File deleted
- ✅ Zero imports remain
- ✅ `yarn build` passes

---

### PHASE 2 GATE

**Commands:**

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test
```

**Success Criteria:**

- ✅ All 268 tests pass (including new transaction REM tests)
- ✅ Schema generator port now accepts compiled contracts
- ✅ Transaction system can store + validate REM
- ✅ Arch-lint: fully compliant

---

## PHASE 3: Token Compliance & Design System (8–12 hours)

### Objective

Eliminate 67 arbitrary Tailwind violations; fix hardcoded colors; implement token compliance linting.

### 3.1 Create ESLint Rule for Arbitrary Tailwind Values

**Sub-task:** Design System Worker | **Estimate:** 2–3h

**Files to create/edit:**

- `/packages/eslint-plugin-ui/src/rules/no-arbitrary-tailwind-values.ts` (NEW)
- `/packages/eslint-plugin-ui/src/index.ts` (register rule)
- `/packages/eslint-plugin-ui/__tests__/rules/no-arbitrary-tailwind-values.test.ts` (NEW)

**Rule Logic:**

1. Detect Tailwind class strings: `className="...text-[Npx]..."`
2. Flag `[...]` arbitrary values EXCEPT `active:scale-[0.98]` (documented exception)
3. Report violation + suggestion to use token

**Enforcement:**

- Add to ESLint config in `.eslintrc.json` (or per-package if needed)
- Pre-commit hook runs ESLint with this rule

**Acceptance Criteria:**

- ✅ Rule correctly detects 67+ arbitrary values in test cases
- ✅ Rule passes documented exception (`active:scale-[0.98]`)
- ✅ Integration test: run against codebase, find violations
- ✅ `yarn lint` passes for rule syntax itself

---

### 3.2 Add Component-Level Tokens to Design System

**Sub-task:** Design System Worker | **Estimate:** 1–1.5h

**Files to edit:**

- `/apps/web/app/globals.css` (add component token definitions)
- Update DESIGN.md §4 with component token documentation

**New Tokens to Define:**

```css
/* Spacing/Sizing Component Tokens */
--button-height: 40px; /* h-10 */
--button-padding-x: 12px; /* px-3 */
--button-padding-y: 8px; /* py-2 */

--input-height: 40px; /* h-10 */
--input-padding-x: 12px; /* px-3 */
--input-padding-y: 8px; /* py-2 */

--card-padding: 16px; /* p-4 */
--card-padding-lg: 24px; /* p-6 */
--card-gap: 16px; /* gap-4 */

--badge-height: 20px;
--badge-padding-x: 8px;

--page-section-gap: 24px; /* vertical spacing between sections */
--form-field-gap: 8px; /* vertical spacing in forms */
```

**Update DESIGN.md:**

- Document all new tokens
- Show how to replace hardcoded sizing with component tokens
- Example: `min-h-[400px]` → `min-h-[var(--canvas-min-height)]`

**Acceptance Criteria:**

- ✅ Component tokens defined in globals.css
- ✅ DESIGN.md updated
- ✅ All Tailwind theme references use CSS variables where applicable

---

### 3.3 Refactor 6 Highest-Violation Files

**Sub-task:** Design System Worker | **Estimate:** 3–4h

**Files to refactor (in order by violation count):**

1. **ModelProgressCard.tsx** (12 violations) — 0.5h
2. **model-card.tsx** (8 violations) — 0.5h
3. **cloud-models-section.tsx** (7 violations) — 0.5h
4. **BoundedContext.tsx** (8+ violations + color hardcoding) — 1–1.5h
5. **Step Header.tsx** (4 violations) — 0.25h
6. **PeerContextNode.tsx** (4+ violations) — 0.25h

**Per-File Template:**

1. Read file
2. Identify arbitrary values + hardcoded colors
3. Map to existing semantic tokens OR new component tokens
4. Replace all instances
5. Run `yarn lint` (new rule should pass)
6. Verify build + visual regression

**Acceptance Criteria:**

- ✅ All 6 files have zero arbitrary Tailwind violations
- ✅ All hardcoded colors replaced with semantic tokens
- ✅ `yarn lint` passes (ESLint rule finds ZERO violations in these files)
- ✅ `yarn build && yarn typecheck` pass
- ✅ Manual visual inspection: no regressions

---

### 3.4 Fix Hardcoded Color Palette

**Sub-task:** Design System Worker | **Estimate:** 2–2.5h

**Current Violations:**

- `bg-blue/10`, `text-blue` (no semantic mapping)
- `bg-emerald-500/10`, `text-emerald-500` (should map to success)
- `text-violet-500` (should map to info or primary)
- `text-sky-500` (should map to info)
- `text-yellow-*`, `text-amber-*` (should map to warning)

**Strategy:**

1. Define Tailwind color overrides in `tailwind.config.ts` to map non-standard colors to semantic tokens
2. OR: Replace hardcoded colors in component code with semantic references

**Files requiring color replacement:**

- ExportStatusStrip.tsx (emerald → success)
- cloud-models-section.tsx (blue → primary)
- model-card.tsx (blue → primary)
- ProjectCard.tsx (yellow → warning)
- DraftCard.tsx (yellow → warning)
- EditorToolbar.tsx (amber → warning)
- BoundedContext.tsx (violet/sky/emerald → semantic tokens)

**Acceptance Criteria:**

- ✅ All hardcoded colors mapped to semantic tokens
- ✅ Dark mode works correctly (automatic via CSS variable delegation)
- ✅ `yarn build` passes
- ✅ Manual visual inspection: colors correct in light/dark modes

---

### 3.5 Handle Canvas Component Inline Styles (Exception-Based)

**Sub-task:** Design System Worker | **Estimate:** 1–1.5h

**Issue:** `BoundedContext.tsx` and `HexagonCanvas.tsx` use inline styles for React Flow integration

**Action:**

1. Document why inline styles are necessary (React Flow requires dynamic positioning)
2. Extract all canvas-specific inline styles into isolated adapter component
3. Mark adapter with `/* DESIGN.md §4 Exception: React Flow integration */` comment
4. Update DESIGN.md §4 to document this exception

**Files to edit:**

- `/apps/web/features/hexagon-canvas/adapters/CanvasNodeStyleAdapter.tsx` (NEW)
- Move inline style logic here
- BoundedContext.tsx imports from adapter instead of computing styles locally

**Acceptance Criteria:**

- ✅ Inline styles isolated to single adapter component
- ✅ Exception documented in both code + DESIGN.md
- ✅ No new inline styles added to presentational components
- ✅ `yarn build` passes

---

### 3.6 Delete Stale Token Export

**Sub-task:** Design System Worker | **Estimate:** 0.1h

**Action:**

1. Edit `/packages/ui/src/tokens/index.ts`
2. Remove `"error"` from `TOKENS.colors` array
3. Verify no imports of `TOKENS.colors.error` exist

**Acceptance Criteria:**

- ✅ Stale export removed
- ✅ Zero references remain
- ✅ `yarn build` passes

---

### PHASE 3 GATE

**Commands:**

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test
```

**Success Criteria:**

- ✅ New ESLint rule runs successfully
- ✅ No violations reported in linted files (67 violations resolved)
- ✅ All 268 tests pass
- ✅ Manual visual inspection: no regressions in light/dark modes

---

## PHASE 4: Package Manifest & Lifecycle (1–2 hours)

### Objective

Add unmonitored packages to manifest; freeze aspirational packages with FROZEN.md files.

### 4.1 Update Manifest: Add Unmonitored Packages

**Sub-task:** Manifest Worker | **Estimate:** 0.25h

**Files to edit:**

- `.architecture/manifest.yaml`

**Changes:**

1. Add `eslint-plugin-ui` to `bounded_contexts` (if not already listed)
2. Verify `ai-pipeline` is listed (OR delete from filesystem)

**Decision Point:**

- If `ai-pipeline` has no code and no plan: **DELETE the directory entirely**
- If `ai-pipeline` will be used: Add to manifest + create package.json

**Recommendation:** DELETION (orphaned, undisciplined)

**Acceptance Criteria:**

- ✅ All packages in `packages/` are either:
  - In manifest, OR
  - Deliberately deleted (ai-pipeline)
- ✅ No orphans remain

---

### 4.2 Create FROZEN.md for Aspirational Packages

**Sub-task:** Manifest Worker | **Estimate:** 0.75–1h

**Create 3 files:**

#### `/packages/transaction-system/FROZEN.md`

```markdown
# Frozen Package: @hexagen/transaction-system

**Status:** Frozen as of Phase 6, 2026-04-25

## Why This Package Was Frozen

- **Zero runtime consumers** on main application path
- No imports in `apps/web/` or `wire.ts`
- Declared as "available" in manifest but never instantiated
- Speculative state machine design lacks live use case

## What Was Preserved

- Domain layer: `SpeculativeTransaction`, `StateTransition`, `ConflictSet`
- Application layer: All port interfaces
- Use case classes: All intact for future activation

## What Was Removed

- Infrastructure adapters: (none; design is still fresh)
- Tests: Reduced to core domain tests only

## Future Activation

Once Phase 5 (REM integration) is complete and transaction lineage use case emerges,
this package can be unfrozen. No migration path needed — contracts are preserved.

## Current Date

2026-04-25 | Frozen pending REM + prompt-compiler determinism work
```

#### `/packages/architectural-enforcement/FROZEN.md`

```markdown
# Frozen Package: @hexagen/architectural-enforcement

**Status:** Frozen as of Phase 6, 2026-04-25

## Why This Package Was Frozen

- **Aspirational scaffold** — marked as "future tooling"
- No runtime responsibility; no consumers
- Tooling should live in `/tools/`, not `/packages/`

## What Was Preserved

- Domain definitions (if any; verify before freezing)

## Disposition

This package should be deleted and functionality moved to:

- ESLint plugins: `packages/eslint-plugin-ui/`
- Linter tooling: `tools/arch-linter/`

## Current Date

2026-04-25 | Frozen pending architecture cleanup decision
```

#### `/packages/code-generation/FROZEN.md`

```markdown
# Frozen Package: @hexagen/code-generation

**Status:** Frozen as of Phase 6, 2026-04-25

## Why This Package Was Frozen

- **Aspirational scaffold** — marked as "future tooling"
- No runtime responsibility; no consumers
- Tooling should live in other packages or `/tools/`

## What Was Preserved

- Domain/application layers if defined

## Disposition

Delete this package. Code generation, if needed, should be integrated into:

- `@hexagen/project-generation/`
- `@hexagen/sync/`

## Current Date

2026-04-25 | Frozen pending architecture cleanup decision
```

**Acceptance Criteria:**

- ✅ All 3 FROZEN.md files created with clear rationale
- ✅ Each explains what was preserved + future activation path
- ✅ Manifest updated to reflect `status: frozen` for these packages

---

### 4.3 Update Manifest YAML for Frozen Packages

**Sub-task:** Manifest Worker | **Estimate:** 0.25h

**Files to edit:**

- `.architecture/manifest.yaml`

**Changes per package:**

```yaml
- name: transaction-system
  status: frozen # Add or update this field
  rationale: "Zero runtime consumers; REM integration pending"
  frozen_date: 2026-04-25

- name: intent-compiler
  status: frozen # Should already exist; verify
  rationale: "Aspirational; design complete but no consumers"

- name: reconciliation-engine
  status: frozen # Should already exist; verify
  rationale: "Aspirational; blocked on REM + compiled contracts"

- name: architectural-enforcement
  status: frozen # Add if not present
  rationale: "Tooling should live in tools/, not packages/"

- name: code-generation
  status: frozen # Add if not present
  rationale: "Tooling should live in tools/ or other packages"
```

**Acceptance Criteria:**

- ✅ Manifest YAML parses (validate with `python3 -c "import yaml; yaml.safe_load(open('...'))`)
- ✅ All frozen packages have `status: frozen`
- ✅ Arch-linter understands frozen packages

---

### 4.4 Delete ai-pipeline Directory (Orphan Cleanup)

**Sub-task:** Manifest Worker | **Estimate:** 0.1h

**Action:**

```bash
rm -rf packages/ai-pipeline
```

**Reason:**

- No package.json
- Zero production code
- Not in manifest
- Violates monorepo discipline

**Acceptance Criteria:**

- ✅ Directory deleted
- ✅ No imports of ai-pipeline remain (`grep -r "@hexagen/ai-pipeline"` returns zero)
- ✅ Manifest updated to remove reference

---

### PHASE 4 GATE

**Commands:**

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test
```

**Success Criteria:**

- ✅ Arch-linter recognizes frozen packages correctly
- ✅ No new violations reported
- ✅ All 268 tests pass
- ✅ Manifest YAML valid

---

## PHASE 5: Final Build Validation & Gate Pass (0.5 hours)

### Objective

Comprehensive system validation; zero regressions; ready for merge.

### 5.1 Full Clean Build

**Sub-task:** QA/Gate Worker | **Estimate:** 0.25h

**Run:**

```bash
rm -rf packages/*/dist .turbo node_modules/.cache
find . -name "*.tsbuildinfo" -delete
yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test
```

**What This Validates:**

- ✅ Zero incremental cache issues
- ✅ All 32 build tasks pass
- ✅ All 52 typecheck tasks pass
- ✅ All linting passes (48 files + arch)
- ✅ All 268 tests pass (no flakiness)

---

### 5.2 Regression Verification

**Sub-task:** QA/Gate Worker | **Estimate:** 0.15h

**Checklist:**

- ✅ Canvas rendering still works (manual visual check)
- ✅ LLM assistant still responds (manual smoke test)
- ✅ No new console errors or warnings
- ✅ Dark mode still works
- ✅ All token changes render correctly

---

### 5.3 Gate Pass Documentation

**Sub-task:** QA/Gate Worker | **Estimate:** 0.1h

**Generate gate pass summary:**

```
## REMEDIATION GATE PASS — April 25, 2026

### Build Status: ✅ PASS
- yarn build: 32/32 tasks ✅
- yarn typecheck: 52/52 tasks ✅
- yarn lint: 48/48 tasks ✅
- yarn lint:arch: COMPLIANT ✅
- yarn test: 268/268 passing ✅

### Phases Completed:
- ✅ Phase 1: Shared Kernel Repatriation
- ✅ Phase 2: AI Pipeline & Transaction REM
- ✅ Phase 3: Token Compliance & Design System
- ✅ Phase 4: Package Manifest & Lifecycle

### Critical Issues Fixed:
- ✅ Shared kernel: 7 context-owned schemas moved
- ✅ Transaction system: REM integration implemented
- ✅ Zod schema: Compiled contract support added
- ✅ Token compliance: 67 arbitrary values removed
- ✅ Package manifest: 4 aspirational packages frozen

### Blockers Remaining: 0

### Ready for Merge: YES ✅
```

---

### FINAL GATE

**Commands:**

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test
```

**Success Criteria:**

- ✅ **All checks pass**
- ✅ **Zero regressions from baseline audit**
- ✅ **All 4 remediation phases complete**
- ✅ **Ready for git commit + push**

---

## Work Plan Summary Table

| Phase | Owner           | Scope                      | Items        | Est. Hours | Gate Criteria                                                   |
| ----- | --------------- | -------------------------- | ------------ | ---------- | --------------------------------------------------------------- |
| **1** | Domain Worker   | Shared kernel repatriation | 4 sub-tasks  | 5–7h       | Build pass; no shared exports of context schemas                |
| **2** | Kernel Worker   | REM + schema generation    | 6 sub-tasks  | 6–8h       | Build + test pass; REM integrated; schema port evolved          |
| **3** | Design Worker   | Token compliance           | 6 sub-tasks  | 8–12h      | Lint rule active; 67 violations resolved; visual OK             |
| **4** | Manifest Worker | Package lifecycle          | 4 sub-tasks  | 1–2h       | Manifest valid; frozen packages documented; ai-pipeline deleted |
| **5** | QA/Gate Worker  | Final validation           | 3 sub-tasks  | 0.5h       | Full build pass; zero regressions; ready for merge              |
|       |                 |                            | **23 total** | **20–29h** |                                                                 |

---

## Decision Points

| If This Happens                | Action                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| Phase N gate fails             | Stop; do NOT proceed to Phase N+1; escalate findings to human |
| Sub-agent encounters ambiguity | Stop; escalate to orchestrator; do NOT guess                  |
| Build fails mid-phase          | Revert all changes in that phase; escalate                    |
| Test flakiness detected        | Investigate + document; may indicate deeper issue             |
| Regression detected at gate    | Revert phase; escalate                                        |

---

## Status & Next Steps

**Current Status:** Plan complete and saved. Ready for Phase 1 delegation.

**Authority:** This plan is approved and binding per AGENTS.md Orchestrator Mode §Step 4.

**Next Action:** Delegate to Domain Worker (Shared Kernel Repatriation).

**Estimated Completion:** 20–29 hours from start of Phase 1.

---

**Generated:** 2026-04-25 | **Authority:** Audit Report (2026-04-25) + Remediation Report (2026-04-24)
