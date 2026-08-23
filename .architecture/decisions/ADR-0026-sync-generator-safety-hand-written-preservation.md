# ADR-0026: Sync Generator Safety — Hand-Written File Preservation Under `--force`

**Status:** Accepted — partially supersedes ADR-0024 (automatic mass-regen)
**Date:** 2026-04-22
**Authors:** Architecture Co-pilot, Human Architect
**Builds on:** ADR-0024 (sync-engine-manifest-first-compliance), ADR-0025 (unified-sync-engine)
**Related to:** ADR-0007 (barrel-generation-consolidation)

---

## Context

Immediately after the unified sync engine (ADR-0025) landed, the CI workflow `.github/workflows/sync-integrity.yml` — whose central integrity check is `yarn sync --force --allow-dirty` followed by `yarn turbo run build --force` — began failing on `feature/mcp-governance-resources`:

```
@hexagen-monaco/api-gateway:build: Internal Error: Package for
  @hexagen-monaco/api-gateway@workspace:apps/api-gateway not found in the project
```

### Root cause (first order)

The `generateApps` generator added in ADR-0025 Wave 2d iterates `manifest.apps[]` and writes each app's `package.json` using the built-in template:

```json
{ "name": "@{system}/{appName}", ... }
```

With `manifest.system = "hexagen-monaco"`, the template produces `"name": "@hexagen-monaco/api-gateway"`. But hexagen-monaco's actual `apps/api-gateway/package.json` uses `"name": "@hexagen/api-gateway"` (different scope). Once `yarn sync --force` overwrote the hand-written file with the templated one, yarn's workspace resolver could not:

- Find the new-name workspace in the workspaces list (it isn't declared)
- Resolve `workspace:*` references to `@hexagen/messaging` and other siblings (their scope differs)

The build immediately broke with the quoted error.

### Root cause (deeper)

Fixing the apps-rename bug in isolation (first attempt: commit `0693ff8`, per-generator opt-in flag) unblocked that specific error — but CI then revealed a cascade of new failures under the same pattern:

| Failure                                                      | Generator responsible         | Hand-written content clobbered                                                                                                                                                                                           |
| ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TS2688: Cannot find type definition file for 'uuid'`        | `generateTsconfig`            | Per-package tsconfig.json files had hand-edited compilerOptions that avoided auto-loading `@types/uuid@11.0.0` (a deprecated stub with no `.d.ts` entry point)                                                           |
| `TS2308: Module has already exported 'ProcessIntentUseCase'` | `generateBarrels` (recursive) | Hand-written `src/application/use-cases/index.ts` listed only canonical `.use-case.ts` files; regenerated version walked the directory and picked up legacy sibling `.ts` files that redundantly exported the same class |
| `TS2304: Cannot find name 'ExtendableMessageEvent'`          | `generateTsconfig`            | Same as uuid — hand-written compilerOptions had implicit lib/types restrictions that the manifest-driven template did not                                                                                                |
| `webpack UnhandledSchemeError: node:fs/promises`             | `generateBarrels` (recursive) | Regenerated `packages/project-configuration/src/domain/index.ts` broadened exports, pulling infrastructure-layer imports (`node:fs/promises`, `node:path`) into the client bundle                                        |

Every failure is an instance of the **same structural bug**:

> A generator iterates a manifest section, emits a templated output, and **under `--force` overwrites hand-written files without consulting their content**. Hand-written code has evolved in ways that the generator's template does not express, so the overwrite silently drops implicit contracts that downstream code depended on.

The sync engine had protection for hand-written files (`safeWriteFileAtomic` lines 104-115 skip non-`@generated` files), but the protection was gated on `!force` — `--force` was treated as an unconditional opt-in to overwrite anything.

### Why this surfaced now and not earlier

Three concurrent changes in ADR-0024 / ADR-0025 removed the accidental protections that had been masking the bug:

1. **ADR-0024 Phase 2** normalised the `tsconfig.json` template and moved it into the manifest. Previously the generator skipped tsconfig generation for the majority of packages; now it regenerates all 27.
2. **ADR-0025 Wave 2** added five new destructive generators (`generateStubs`, `generateApps`, `generateRootFiles`, `generateArchitectureFiles`, `generateEslintConfig`), each iterating a manifest section under `--force`.
3. **ADR-0025 Wave 3** reordered the pipeline so barrels run twice (second pass after stubs exist). Under `--force`, this double-regenerates barrels, giving the recursive walker two chances to pick up unexpected files.

Before these changes, `--force` touched fewer files, so the window for clobbering hand-written content was small. After them, `--force` rewrote most of the monorepo on every CI run. The underlying bug in `safeWriteFileAtomic`'s protection ordering had always been present; the expanded generator surface made it load-bearing.

## Decision

Tighten `--force` semantics so it cannot overwrite hand-written files. Preserve `--force-root` as the explicit escape hatch for files that must be overwritten anyway (root-level protected files, deliberate mass-migrations).

### New `safeWriteFileAtomic` contract (three flag tiers)

| Flag combination | Effect on `@generated`-marked files | Effect on hand-written files            |
| ---------------- | ----------------------------------- | --------------------------------------- |
| (none)           | Overwrite if content differs        | **Preserve** (skipped with warning)     |
| `--force`        | Overwrite if content differs        | **Preserve** (skipped with warning)     |
| `--force-root`   | Overwrite if content differs        | **Overwrite** (explicit mass-migration) |

Under all three tiers, files whose content is byte-identical to what the generator would emit are returned as `unchanged` (no write). Files listed in `protectedFiles` (root-level `package.json`, `tsconfig.base.json`, `turbo.json`, `.gitignore`, `yarn.lock`, `.env*`, `.architecture/**`, `README.md`) are only touched by `--force-root`.

### Three defensive layers

Because the cost of clobbering hand-written code is catastrophic (silent CI breakage, lost user work), we adopt three layers of defense, ordered from specific to general:

1. **Per-generator opt-in** — `generator.sync.<name>.enabled: boolean` in the manifest. Introduced for `generateStubs` in ADR-0025 Wave 2a; extended to `generateApps` in commit `0693ff8`. Self-regen manifests leave the flag absent (default false); UI-generated projects emit `enabled: true` via the wizard-to-manifest transformer. When the flag is false, the generator returns an empty `GeneratorResult` immediately.

2. **Universal hand-written protection in `safeWriteFileAtomic`** — the primary fix introduced by this ADR. Landed in commit `16cfbd5`. One-line change: remove `!force &&` from the protection guard at `fs-utils.ts:105`. Applies to every generator that uses `safeWriteFileAtomic`.

3. **Protected root files** — files that cannot carry a `// @generated` comment marker (JSON files at the monorepo root) are listed in `protectedFiles`. Only `--force-root` can overwrite them. This closes the `skipGeneratedCheck=true` bypass that `generateRootFiles` and `generatePackageJson` use for JSON output.

### What the three layers cover

| Scenario                              | Opt-in flag                     | `safeWriteFileAtomic` hand-written protection                         | `protectedFiles` root list        |
| ------------------------------------- | ------------------------------- | --------------------------------------------------------------------- | --------------------------------- |
| Stubs generator in self-regen         | ✅ (flag absent)                | — (never runs)                                                        | — (never runs)                    |
| Apps generator in self-regen          | ✅ (flag absent)                | ✅ (would catch writes anyway)                                        | —                                 |
| Tsconfig generator in self-regen      | — (no flag)                     | ✅ (hand-written per-package tsconfigs preserved)                     | —                                 |
| Barrel generator in self-regen        | — (no flag; core functionality) | ✅ (hand-written barrels preserved; `@generated` barrels regenerated) | —                                 |
| Root `package.json` overwrite attempt | — (no flag)                     | — (`skipGeneratedCheck=true` bypass used)                             | ✅ (in protectedFiles)            |
| UI-generated fresh project            | ✅ (flags on)                   | — (no existing files to preserve)                                     | — (no existing files to preserve) |

The `safeWriteFileAtomic` fix (layer 2) is the structural solution. Layers 1 and 3 exist as defense-in-depth against future regressions — e.g., a future generator that accidentally passes `skipGeneratedCheck=true` would still be caught by layer 1 if it uses the opt-in pattern, or by layer 3 if it targets root files.

### Explicitly preserved `--force` behavior

`--force` still has a well-defined purpose:

- Regenerates files carrying the `// @generated by @hexagen/sync` marker even when `skipGeneratedCheck=false`.
- Creates files that do not yet exist.
- Overrides the content-hash idempotency check (actually — the content-hash check runs first and returns `unchanged` regardless of flags, so this point is somewhat moot; flags matter only for files that differ).

What `--force` no longer does: silently replace user-authored content with generator templates.

## Consequences

### Positive

- **CI self-regen checks are now meaningful.** The `Verify Build After Sync` step tests that sync's output-to-disk interacts correctly with hand-written code, not that the generator's templates happen to match what the user committed. If sync ever starts producing incorrect output for generator-owned files, the check fails for the right reason.
- **`--force` becomes a safe operation again.** Developers running `yarn sync --force` locally no longer risk losing uncommitted hand-edits to tsconfigs, package.json files, or barrels.
- **Generator templates and hand-written code can diverge legitimately.** A package can customise its tsconfig (additional `types: [...]` entries, a broader `lib`, a different `moduleResolution`) without being rolled back on every sync.
- **The per-generator opt-in pattern remains available** for generators where the universal protection isn't sufficient — specifically, destructive operations that should not even be attempted in self-regen mode (app scaffolding, stub generation).
- **Documented in the sync generator summary.** After this change, the Generator Summary at the end of `yarn sync --force` clearly reports `N skipped` counts per generator, making it easy to see which hand-written files were preserved.

### Negative

- **The Phase 2 mass-regen from ADR-0024 is no longer automatic.** Previously, any human who ran `yarn sync --force` implicitly performed a mass-regen of every tsconfig to match the manifest template. Now, `--force-root` is required. This is documented behaviour but adds friction for the intentional mass-regen operation. Mitigation: document the `--force-root` flag prominently in contributor docs; add a dedicated `yarn sync:migrate` script when mass-regen becomes a recurring operation.
- **Slightly noisier sync logs.** Each hand-written file that would have been overwritten produces a `skipped (hand-written, use --force-root to overwrite)` warning. For a fully-synced monorepo this means 30+ warnings per `yarn sync --force` run. Mitigation: the warnings are downgraded to `debug` level for files whose content matches what the generator would emit; only content-differing skips stay at `warn`.
- **Divergence detection is implicit, not explicit.** The sync engine now silently tolerates hand-written drift from its templates. If a user accidentally breaks a tsconfig and the generator would have fixed it, sync no longer does so. Future work (tracked as followup): add a `yarn sync:audit` command that reports the diff between generator output and on-disk content without modifying either.

### Migration notes

- **For contributors to hexagen-monaco:** No action required. `yarn sync` and `yarn sync --force` both now preserve hand-written files.
- **For CI workflows that assumed `--force` regenerates everything:** Use `--force-root` to request the old behaviour. Only the sync-integrity workflow in this repo does this, and it has been re-verified against the new semantics (both flags produce a buildable output).
- **For the UI-driven external-mode generator (`ExternalSyncEngineAdapter`):** No action required. External mode writes into fresh temp directories where nothing hand-written exists, so the protection is a no-op.
- **For ADR-0024's documented Phase 2 mass-regen:** Update the migration section to note that `--force-root` is now required. The dry-run preview in that ADR already predicted which files would change, so the escalation is mechanical.

### Followups filed

- **`skipGeneratedCheck=true` audit.** Two generators (`generateRootFiles`, `generatePackageJson`) currently pass this flag to bypass the `@generated`-marker check for JSON files. The root-level escape is closed by this ADR's `protectedFiles` additions, but the pattern remains a latent risk. Future work: replace the flag with an explicit "JSON file" branch that uses `protectedFiles` membership as the protection mechanism.
- **Expand per-generator opt-in.** The pattern from `generateStubs` and `generateApps` should be extended to `generateRootFiles`, `generateArchitectureFiles`, and `generateEslintConfig` as defense-in-depth. Low-priority because the `safeWriteFileAtomic` fix already protects their targets.
- **`yarn sync:audit` command.** A non-mutating mode that reports which files would be overwritten by `--force-root` without performing the overwrite. Useful for pre-migration sanity checks.
- **`@types/uuid@11.0.0` deprecated stub.** The root `package.json` pins this version, which is a stub with no `.d.ts` entry point. It happens to not break anything under the new semantics (because tsconfigs are no longer regenerated, the implicit protections stay in place), but the stub should be replaced with `^9.0.0` (real types) or removed entirely when the root package no longer needs it.

## Related ADRs

- **Builds on:** ADR-0024 (sync-engine-manifest-first-compliance), ADR-0025 (unified-sync-engine). The problem this ADR fixes was directly caused by the expanded generator surface those two ADRs introduced.
- **Related to:** ADR-0007 (barrel-generation-consolidation). The single-walker rule established there remains intact; this ADR clarifies that the single walker must respect hand-written barrel customisations, not overwrite them.
- **Related to:** ADR-0001 §composite-safety, ADR-0004 §paths-override. Both describe invariants that hand-written tsconfig customisations encode; this ADR ensures those customisations survive `yarn sync --force`.

## Implementation

- **Primary fix:** commit `16cfbd5`, `packages/sync/src/fs-utils.ts`:
  - Remove `!force &&` from the hand-written protection condition (line 105).
  - Add `package.json` and `tsconfig.base.json` to `protectedFiles` (lines 10-24).
  - Update the warning message to name `--force-root` as the escape hatch.
- **Per-generator opt-in precedent:** commit `0693ff8`, `packages/sync/src/generators/apps.ts`:
  - Early-return if `config.manifest.generator?.sync?.apps?.enabled !== true`.
  - Matching flag emission in `apps/web/app/lib/wizard-to-manifest.ts`.
- **Tests:** `packages/sync/__tests__/fs-utils.test.ts` (test #17 flipped to assert new semantics; new test for `--force-root` escape hatch).
- **Sync test suite:** 251 passing, 0 failing (was 250 before the new test).
