# ADR-0055: Feature-Slice Boundary — Cross-Slice Imports Are Debt, Neutral Homes Are the Remedy, and the Rule Must See Aliases

**Date:** 2026-08-16
**Status:** Proposed
**Type:** Architecture
**Relates to:** ADR-0034 (creation-flow de-modalization — its "Feature Isolation" section records accommodations this ADR retires; see the amendment note filed there), ADR-0021 (`@internal` ACL types, enforced by the same firewall), ADR-0054 (arch-lint enforcement posture — this ADR applies the same "a check's scope must be visible in its output" principle to the web boundary).

> This decision is referred to as **D-S1** in `docs/planning/2026-08-16-verification-coverage-followups.md` (§FU-3). That plan records the investigation; this ADR records the decision it produced.

## Context

`apps/web/features/` held ten vertical slices at the time of the investigation (`code-view`, `export`, `governance-assistant`, `hexagon-canvas`, `landing`, `llm-driver`, `manifest-generation`, `monaco-editor`, `project-wizard`, `workspace-shell`); it holds **nine** today, because `llm-driver` was never a slice and this decision retired it (see Consequences). Cross-slice imports are already forbidden at **error** level — `apps/web/eslint.config.js` wires `hexagen-ui/no-feature-slice-imports` for `features/**/*.{ts,tsx}`. The repo therefore has no open question about _whether_ slices may reach into each other. It had a question about whether the rule was true.

Five grounded observations forced this decision.

1. **The rule has never seen an `@/` import.** `packages/eslint-plugin-ui/src/rules/no-feature-slice-imports.ts:31` reads `if (!source.startsWith("../") && !source.startsWith("./")) return;` — it inspects relative specifiers only and returns early on everything else. `apps/web/tsconfig.json` maps `@/*` across `./app/*`, `./components/*`, `./lib/*`, `./hooks/*`, `./features/*` and `./types/*`, and `apps/web` writes ~206 imports in alias form. A TypeScript-aware walk of all 508 files under `features/` found **18 cross-slice specifier sites in alias form across 17 slice→slice edges**, none of which the rule can see. It is also visitor-limited: it registers only an `ImportDeclaration` visitor, so `export … from`, dynamic `import()`, `TSImportType` and `vi.mock()` are outside its reach regardless of specifier form.

2. **The rule additionally reports zero because two real violations are switched off.** `apps/web/features/governance-assistant/GovernancePanelWrapper.tsx` and `apps/web/features/project-wizard/WizardStepRouter.tsx` each carry an inline `// eslint-disable-next-line hexagen-ui/no-feature-slice-imports`. Confirmed via ESLint's `suppressedMessages`: `eslint features` currently reports **0 errors across 508 files** while two known violations sit disabled in the tree.

3. **The rule as drawn caused duplication rather than preventing coupling.** ADR-0034's "Feature Isolation" section records `blankProjectConfig` being **inlined** in `NewProjectPage.tsx` "instead of importing `emptyFormValues` from `project-wizard/config.ts`". That fork survived as `apps/web/features/landing/domain/createBlankProjectConfig.ts`, whose own JSDoc read "Mirrors `emptyFormValues` … keep the two in sync" — a hand-maintained duplicate of the ADR-0041 single-app preset, created _by_ the boundary rule.

4. **The next author routed around the blind spot, in writing.** `apps/web/features/manifest-generation/genesis-workbench/genesisProjectSettingsStore.ts` carried a comment stating that "the module-level lint rule only isolates relative feature imports; these two are the repo's canonical seeding sources", with a parallel note in `GenesisProjectSettingsSection.tsx`. The evasion was documented on `main` and would have been cited as precedent.

5. **The pinned couplings were not couplings.** A per-pair investigation of all nine alias-form pairs found **zero** cases of legitimate slice-to-slice composition. Every one was a symbol with no dependency on its host slice: `apps/web/features/llm-driver/` turned out to be app-global infrastructure (its `LocalLLMProvider` mounts in `app/layout.tsx` at the root wrapping every route; six of its eight consumers were already in `app/`; the directory held nine files and zero components); `apps/web/features/project-wizard/config.ts` had **four independent consumer groups outside its own slice** and ~21 importers; `template-manifest.generated.ts` was generator output whose source of truth is `packages/template-engine`; `createBlankProjectConfig` was the ADR-0034 fork.

## Decision

**1. Cross-slice imports are debt, not composition. There is no "shared-config provider" exemption.**

All nine pinned pairs are classified as misplaced code. A general exemption was considered and rejected: it would have to read "any slice may import any module named `config`, `<name>-config` or `<name>.generated` from any other slice", which is unenforceable and self-defeating — every slice would name its shared surface `config.ts`. The narrow alternative, a per-symbol allowlist, is what `CROSS_SLICE_ALIAS_BASELINE` already is, and it is designed to shrink.

**2. The remedy is extraction to a neutral home, not an exemption.** Three homes, by kind:

| Kind                                                 | Home                   | Precedent                                                   |
| ---------------------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| App-global React context / infrastructure hook       | `apps/web/app/lib/`    | `app/lib/vault-context.tsx`                                 |
| Shared presentational component                      | `apps/web/components/` | `components/chat/`, already reached via `@/chat/…`          |
| Slice-agnostic config, domain preset, generated data | `apps/web/lib/`        | new; `lib` is an alias root resolving **before** `features` |

A neutral module **must not import from `features/`**. That inverts the dependency the extraction exists to remove.

**3. Generated output never lands in a slice.** A generator whose source of truth is a package has no slice; the directory it lands in only records which consumer was written first. Generator output goes to a neutral root so cross-slice consumption is legal by construction rather than by exemption.

**4. The rule must be taught to resolve `@/` aliases** — reading `paths` from `apps/web/tsconfig.json` — and to visit the specifier forms it currently ignores. Measured cost: **16 new errors across 12 files**, which is one PR, not a staged rollout. Sequencing is deliberate: **the extractions land first, the rule fix last**, so the fix becomes the forcing function that stops the class returning rather than a wall of build failures with nowhere to go.

**5. Both gates stay.** `validate-ui-boundary.sh`'s check 6 is not made redundant by fixing the rule, for one decisive reason: **it cannot be switched off per-line**. Observation 2 shows why that matters. It also fails on a _stale_ baseline entry, so the allowlist cannot rot into permanent permission — a property ESLint has no equivalent for. Its scope should narrow to that anti-suppression role rather than competing as a general import scanner.

**6. `workspace-shell` remains the composition-root exemption**, and the two gates must be reconciled when the rule is fixed: the shell script exempts `workspace-shell` as an import **target**, while the rule exempts it only as a **source**. That divergence is latent today purely because of the alias blind spot and will surface the moment it closes.

## Consequences

**Landed at the time of writing** (baseline **9 → 3** pins):

| PR              | Extraction                                                                           | Pins |
| --------------- | ------------------------------------------------------------------------------------ | ---- |
| #463 `e19fcf10` | generated template manifest → `lib/generated/`                                       | 1    |
| #464 `b0269340` | `apps/web/features/llm-driver/` → `app/lib/local-llm-context.tsx`, directory deleted | 1    |
| #467 `cf7ccc4e` | `project-config` presets/options/applications → `lib/`                               | 4    |

#464 also retires the `features/llm-driver` vs `packages/llm-driver` name collision that made `@/llm-driver/*` ambiguous to every reader and every checker.

**Outstanding:**

- **Three pins remain**, all into `manifest-generation` — one extraction, shared UI to `apps/web/components/`.
- **The rule fix is unbuilt.** Until it lands, the alias half of the boundary is enforced only by `validate-ui-boundary.sh`.
- **`.architecture/invariants/layer-rules.yaml` carries a `driver_slice_exceptions` entry keyed on `apps/web/features/llm-driver/`**, a directory #464 deleted. It is now a dangling path, and that block has exactly one entry — so retiring it raises whether the concept goes with it. Nothing reads it but the MCP resource surface.
- **A laundering channel neither gate can see:** `app/contexts/ExportContext.tsx` imports the `export` slice's payload types and places them in its public context signature, so `project-wizard/SummaryStep.tsx` and three `workspace-shell` files are structurally bound to that slice through a specifier containing neither `../` nor a slice name.
- **`validate-ui-boundary.sh` cannot see `lib/` → `features/` or `app/` → `features/` edges** — it iterates only slice directories. Decision 2's "must not import from `features/`" is therefore convention-held, not gate-held.

**Costs accepted:** three more top-level directories carry web-shared code, and `apps/web/lib/` now mixes server-only modules (`better-sqlite3` stores, the rate limiter) with client-safe config. Verified safe — no `lib/index.ts` barrel exists, so no server code is pulled into the client bundle — but the directory's meaning is muddier than a dedicated `shared/` would be. A dedicated root was rejected as needing both a `tsconfig` `paths` entry and an addition to `ALIAS_ROOTS_BEFORE_FEATURES` in the boundary script, for no gain the alias roots do not already provide.

**ADR-0034 is amended, not superseded.** Its de-modalization decision stands; only the accommodations its "Feature Isolation" section recorded are retired. See the amendment note filed in that ADR.
