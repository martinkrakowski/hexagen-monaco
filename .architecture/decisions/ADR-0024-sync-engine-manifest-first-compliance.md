# ADR-0024: Sync Engine Manifest-First Compliance

**Status:** Proposed
**Date:** 2026-04-22
**Authors:** Architecture Co-pilot, Human Architect
**Supersedes (in part):** Sections of ADR-0002 (auto-generated tsconfig refs), ADR-0003 (manual reference fixes for project-generation)
**Reconciles:** ADR-0001 §composite-safety, ADR-0004 §paths-override

---

## Context

Investigation triggered by the `governance` bounded context CI failure (commit `4838e33`) revealed that the sync engine has systemic decay. It advertises a declarative manifest-driven contract but its generators consume only a fraction of the manifest sections they should.

Five root causes were identified:

1. **`generator.sync.layers` is read but never declared.** `sync-engine.ts:160` reads `config.manifest.generator?.sync?.layers ?? {}`. The manifest never sets this section. Result: `ensureLayerFolders()` does nothing, no `src/` directories are scaffolded for new packages.

2. **`workspaceDefaults.tsConfig` is declared but never read.** `.architecture/manifest.yaml:58-75` defines a complete tsconfig template. `tsconfig.ts` ignores it entirely and uses a hardcoded template at lines 44-58.

3. **`bounded_contexts[].depends_on` is consumed only by `arch list`.** Neither `package-json.ts` nor `tsconfig.ts` reads it, so new packages get empty `dependencies: {}` and no `references: []`.

4. **`exports` field is never emitted by `package-json.ts`.** Line 30-53 has only `main` + `types`. Bootstrap invariant #8 (`exports-field-mandatory`) is unenforced.

5. **Hardcoded skip-list pattern proliferates.** `tsconfig.ts:31` has `if (moduleName === "sync" || moduleName === "shared" || moduleName === "ui")`. The manifest already supports `bounded_contexts[].generator` overrides but the generator does not consume them.

Commit archeology shows commit `b2b8c6c` (Mar 12, 2026) — _"fix: remove auto-generated tsconfig references that cause circular dependencies"_ — was the inflection point. The pre-fix generator added every package as a reference to every other package (real bug, caused TS6305). The fix removed all references entirely instead of changing the algorithm to use `depends_on`. This left the codebase reliant on `paths: {}` + Node module resolution per ADR-0004, which works for `tsc --noEmit` and webpack but degrades `tsc --build` incremental compilation.

---

## Decision

Restore the sync engine's contract with `.architecture/manifest.yaml` via two phases.

### Canonical contract

1. **Manifest is authoritative.** Every generator template lives in `manifest.yaml`. Generators read templates; they do not embed them.
2. **`depends_on` is the single source for cross-package linkage.** It expands to:
   - `package.json`: `dependencies: { "@hexagen/<name>": "workspace:*" }`
   - `tsconfig.json`: `references: [{ "path": "../<name>" }]`
3. **Composite project references are required for incremental builds (`tsc --build`), but optional for runtime correctness** (which is handled by `paths: {}` + Node module resolution per ADR-0004). This reconciles ADR-0001/0002/0003/0004: references exist for build ordering; paths-override exists for type resolution.
4. **Three-level merge cascade:** per-context `bounded_contexts[].generator.tsConfig` override > `workspaceDefaults.tsConfig` > generator built-in fallback. Same for `packageJson`.
5. **Hardcoded skip lists are deprecated.** Special packages (`sync`, `shared`, `ui`) declare their non-default tsconfig via `bounded_contexts[<name>].generator.tsConfig` in the manifest.

### Phase 1 — Unblock new packages (no behavior change for existing packages)

| #   | Change                                                                  | File                                                      |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| 1.1 | Add `generator.sync.layers` template to manifest                        | `.architecture/manifest.yaml`                             |
| 1.2 | Make `package-json.ts` consume `depends_on` → workspace deps            | `packages/sync/src/generators/package-json.ts`            |
| 1.3 | Make `package-json.ts` emit `exports` field when missing                | same                                                      |
| 1.4 | Fix barrel quote-style: emit double quotes to match repo prettier       | `packages/sync/src/generators/barrels/utils.ts`           |
| 1.5 | Add idempotency test: `yarn sync --allow-dirty && git diff --exit-code` | `packages/sync/__tests__/integration/idempotency.test.ts` |

### Phase 2 — Architectural cleanup (one-time tsconfig normalization across packages)

| #   | Change                                                                                | File                     |
| --- | ------------------------------------------------------------------------------------- | ------------------------ |
| 2.1 | Move tsconfig template into `workspaceDefaults.tsConfig`; tsconfig generator reads it | manifest + `tsconfig.ts` |
| 2.2 | Implement per-context `generator.tsConfig` override merge                             | `tsconfig.ts`            |
| 2.3 | Eliminate hardcoded skip list (`sync`, `shared`, `ui` move to manifest overrides)     | manifest + `tsconfig.ts` |
| 2.4 | Make `tsconfig.ts` emit `references` from `depends_on`                                | `tsconfig.ts`            |

---

## Consequences

### Positive

- New packages scaffold correctly via `yarn sync` alone, no manual fix-ups
- `--force` becomes safe: templates come from manifest, not from arbitrary disk state
- Reconciles four prior ADRs into one coherent contract
- Eliminates the cosmetic-churn pattern (50+ barrels flipping quote styles per sync)
- `bounded_contexts[].depends_on` becomes meaningfully load-bearing (used by 3 generators)

### Negative

- **One-time churn** in Phase 2: existing tsconfigs converge on the manifest template. Expected diff bounded to: references arrays added from `depends_on`; `emitDeclarationOnly` and `declarationMap` normalized.
- Per-context overrides become the new extension point for special packages, requiring documentation when authors add a new special-case package.
- Phase 2 mass regen requires careful human review before merging (similar to the failed `--force` attempt that motivated this ADR).

### Migration

- **Phase 1 commit:** zero behavior change for existing packages. Only `governance` and any future new packages benefit.
- **Phase 2 commit:** delivers the code change but does NOT run `yarn sync` as part of the commit. The mass regen is a separate, human-reviewed operation.
- Bootstrap invariants (AGENTS.md §7) gain enforcement: invariants 4, 5, 8 become testable via the new Phase 1.5 idempotency test.

---

## Related ADRs

- **Reconciles:** ADR-0001 (composite-safety invariant), ADR-0004 (paths-override strategy)
- **Supersedes (in part):** ADR-0002 §"Fix tsconfig.json References Path", ADR-0003 §8 "Fix tsconfig References"
- **Builds on:** ADR-0007 (barrel generation consolidation)
- **Succeeded by:** ADR-0025 (unified sync engine — completes the manifest-first vision)
- **Related work:** Commit `4838e33` (governance package CI fix), commit `b2b8c6c` (the references-removal that triggered this decay)

---

## Update 2026-04-22: Unified Engine Landed (ADR-0025)

The unified sync engine (ADR-0025) has landed. The Phase 2 mass regen described in §Migration above is now safer for two reasons:

1. **Root files are manifest-driven.** `package.json`, `tsconfig.base.json`, and `turbo.json` now come from `monorepo.rootFiles` templates in the manifest (with built-in fallbacks in the engine). `safeWriteFileAtomic` protection ensures mass regen cannot inadvertently clobber these without `--force-root`. Root-file template drift between the adapter and the engine is no longer possible because there is only one template source.

2. **The stale-barrel bug that made generated projects require post-extract `yarn sync` is fixed.** The sync engine now runs a two-pass barrel generation: stubs are emitted in pass 1 of the Content phase, then the barrel walker runs a second time in the Barrels phase to pick up newly-created stub files. Generated projects are buildable immediately after extraction.

See ADR-0025 for the full unified contract, the new manifest sections (`generator.sync.stubs`, `monorepo.rootFiles`, `monorepo.archInvariants`, `apps[]`, `generator.sync.apps.frameworks`, `monorepo.workspaceDefaults.eslint`), and the three-phase pipeline ordering.
