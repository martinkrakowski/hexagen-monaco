# Phase 6: Publishable Sync CLI via `tsup` — Work Summary

**Status:** ✅ Approved | **Priority:** High (Enables npm publishing of `@hexagen/sync`)
**Effort:** ~4 hours | **Supersedes:** Original "NodeNext ESM Mass Migration" plan
**Authority:** ADR-0009 (Published CLI Bundling); AGENTS.md Module Resolution Appendix

---

## Executive Summary

`@hexagen/sync` is scheduled to be published to npm and consumed by generated HexaGen
projects (`npx hexagen …`). The original Phase 6 plan proposed a monorepo-wide flip to
`moduleResolution: nodeNext` affecting ~900 source files across 28 packages. After review,
that approach was **rejected** in favor of a narrower, industry-standard solution:

- **Bundle `@hexagen/sync` with [`tsup`](https://tsup.egoist.dev/)** — producing a
  self-contained, ESM-valid published artifact.
- **Keep the existing dual-resolution policy** (bundler for app-consumed packages;
  NodeNext only where Node executes directly). Policy already codified in `AGENTS.md`.
- **Retire `scripts/fix-esm-barrels.js`** once bundling is proven (follow-up cleanup).

This rescope reduces risk, preserves ~900 files of source code untouched, and aligns with
how Vercel AI SDK, Biome, Drizzle, Vitest, Astro CLI, and most modern published CLIs ship.

---

## Why Bundling (Option A) — Not Mass Migration

| Concern                           | Mass NodeNext Migration            | tsup Bundling                          |
| --------------------------------- | ---------------------------------- | -------------------------------------- |
| Source files touched              | ~900                               | **0**                                  |
| Packages affected                 | 28                                 | **1** (`@hexagen/sync`)                |
| AGENTS.md policy reversal         | Yes — requires new ADR             | **No** — aligns with existing policy   |
| Transitive workspace-dep exposure | Consumers see 5+ `@hexagen/*` pkgs | **Consumers see 1 package**            |
| Generated project compatibility   | Depends on consumer resolution     | **Works in Next.js, Vite, plain Node** |
| Developer DX friction             | `.js` extensions forever           | **Unchanged**                          |
| Rollback surface                  | 28 packages                        | **1 package**                          |
| Industry precedent                | Rare at this scale                 | **Ubiquitous for published CLIs**      |
| Estimated effort                  | 8–16 hours (realistic)             | **~4 hours**                           |

Full rationale: `.architecture/decisions/ADR-0009-published-cli-bundling.md`.

---

## Scope

### In Scope

- `@hexagen/sync`: swap `tsc` build → `tsup` build
- Inline workspace dependencies (`@hexagen/governance`, `@hexagen/project-configuration`,
  `@hexagen/shared`, `@hexagen/visualization`) into published bundle
- Emit proper ESM with resolved extensions, `.d.ts` bundle, source maps
- Preserve CLI binary entrypoint (`bin: hexagen → dist/cli.js`)
- Update `AGENTS.md` appendix
- Create ADR-0009

### Out of Scope (This Phase)

- Retiring `scripts/fix-esm-barrels.js` (separate follow-up once bundling is verified)
- Publishing to npm registry (separate release process)
- Flipping other packages to NodeNext
- Touching source code in any of the 5 dependency-tree packages

---

## Atomic Phase Plan

### Phase 6-plan — Governance & Documentation (0.5h)

Update plan docs, write ADR, update AGENTS.md before any tooling change.

| #   | File                                                         | Action                   |
| --- | ------------------------------------------------------------ | ------------------------ |
| 1   | `docs/phase-6-nodext-esm-summary.md`                         | MODIFY (this)            |
| 2   | `docs/remediation-phase-6-esm-migration.md`                  | MODIFY — mark superseded |
| 3   | `.architecture/decisions/ADR-0009-published-cli-bundling.md` | CREATE                   |
| 4   | `AGENTS.md` Module Resolution appendix                       | MODIFY                   |

**Gate A:** Commit governance + plan docs. No functional changes yet.

---

### Phase 6a-config — Tooling Wiring (1h)

Add `tsup`, configure it, swap build script.

| #   | File                           | Action                                          |
| --- | ------------------------------ | ----------------------------------------------- |
| 5   | `packages/sync/package.json`   | MODIFY — add `tsup` devDep; swap `build` script |
| 6   | `packages/sync/tsup.config.ts` | CREATE — bundler config, entries, external pins |
| 7   | `packages/sync/tsconfig.json`  | MODIFY — only if tsup requires adjustment       |
| -   | `yarn.lock`                    | AUTO — via `yarn install`                       |

**Validation:**

- V1: `yarn install` succeeds
- V2: `yarn workspace @hexagen/sync build` produces `dist/index.js`, `dist/cli.js`,
  `dist/index.d.ts`, `dist/cli.d.ts` (+ source maps)
- V3: `node packages/sync/dist/cli.js --help` prints help text

**Gate B:** Commit tooling wiring.

---

### Phase 6b-verify — Local Validation (0.5h)

Run full CI suite against the new build.

- V4: `yarn typecheck && yarn lint && yarn lint:arch` — all green
- V5: `yarn test` — all pre-existing tests pass; no regressions

**Gate C:** Halt if any command fails; remediate before proceeding.

---

### Phase 6c-publish — npm-pack Smoke Test (1h)

Prove the bundle installs and executes as an external npm package.

```bash
cd packages/sync
npm pack                                     # → hexagen-sync-x.y.z.tgz
mkdir -p /tmp/hexagen-sync-fixture
cd /tmp/hexagen-sync-fixture
npm init -y
npm install /path/to/hexagen-sync-x.y.z.tgz
npx hexagen --help                           # → must print help
```

- V6: Fixture project has zero `@hexagen/*` packages in its `node_modules` (proves
  workspace deps were inlined)
- V6: `npx hexagen --help` exits 0

**Gate D:** Halt if fixture fails; iterate on tsup config.

---

### Phase 6d-docs — Consumer Documentation (0.5h)

| #   | File                      | Action                                                |
| --- | ------------------------- | ----------------------------------------------------- |
| 8   | `packages/sync/README.md` | CREATE or MODIFY — installation, usage, bundle layout |

**Gate E:** Commit docs.

---

### Phase 6e-final — Full CI Simulation & Final Commit (0.5h)

Clean CI run from scratch:

```bash
rm -rf packages/*/dist .turbo node_modules/.cache
find . -name "*.tsbuildinfo" -delete
yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test
```

**V7:** All gates green from cold cache.

Final commit. Phase 6 complete.

---

## Success Criteria

- ✅ `@hexagen/sync` builds via `tsup` (not `tsc`)
- ✅ `dist/cli.js` is a self-contained ESM bundle (no workspace dep imports at runtime)
- ✅ `.d.ts` declarations bundled correctly
- ✅ Binary `hexagen` resolves under `npm install`
- ✅ Fixture project executes `npx hexagen --help` successfully with zero `@hexagen/*`
  packages in its `node_modules`
- ✅ Full monorepo CI (`build`, `typecheck`, `lint`, `lint:arch`, `test`) passes
- ✅ AGENTS.md policy reaffirmed (no reversal)
- ✅ ADR-0009 merged documenting the decision
- ✅ `scripts/fix-esm-barrels.js` still works for `@hexagen/project-configuration`
  (untouched in this phase)

---

## Risk Assessment

| Risk                                       | Likelihood | Impact | Mitigation                                       |
| ------------------------------------------ | ---------- | ------ | ------------------------------------------------ |
| tsup mis-bundles workspace dep             | Low        | High   | Fixture smoke test (V6) catches before publish   |
| `.d.ts` bundle resolution issues           | Medium     | Medium | Inspect `dist/index.d.ts`; verify in fixture tsc |
| Commander/js-yaml externalized incorrectly | Low        | Medium | Pin in `tsup.config.ts` `noExternal`             |
| CLI stdout/stderr behavior changes         | Low        | Medium | V3 smoke test + manual sanity check              |
| Pre-existing test failures surface         | Medium     | Low    | Already baselined; document in V5                |
| Size regression (bundle too large)         | Low        | Low    | Measure `dist/cli.js` size; acceptable <1 MB     |

---

## Follow-Up Work (Separate Phases)

1. **Retire `scripts/fix-esm-barrels.js`** — after bundling proven, evaluate whether
   `@hexagen/project-configuration` still needs post-build fix (depends on whether any
   non-bundled consumer imports it). Separate cleanup phase.
2. **npm publish pipeline** — CI job to publish `@hexagen/sync` on tag. Separate release
   engineering phase.
3. **Generated project integration tests** — end-to-end test that generates a fresh
   project and runs `npx hexagen` against it. Separate QA phase.

---

## References

- **ADR:** `.architecture/decisions/ADR-0009-published-cli-bundling.md`
- **Superseded detailed spec:** `docs/remediation-phase-6-esm-migration.md`
- **AGENTS.md Module Resolution appendix** (updated in Phase 6-plan)
- **tsup docs:** https://tsup.egoist.dev/
- **Industry precedent:** Vercel AI SDK, Biome, Drizzle ORM, Vitest, Astro CLI

---

## Key Decisions (Codified in ADR-0009)

1. **Why not NodeNext everywhere?** Reverses existing AGENTS.md policy; 900-file blast
   radius; no runtime benefit for bundler-consumed packages.
2. **Why `tsup`?** Battle-tested, esbuild-powered, handles ESM+CJS+dts, used by major
   published TS CLIs.
3. **Why bundle workspace deps?** External consumers install one package, not five.
   Version stability. Smaller supply-chain surface.
4. **Why keep `fix-esm-barrels.js` for now?** Still serves `@hexagen/project-configuration`'s
   own build. Retirement is a separate cleanup once sync bundling is proven.

---

**Created:** 2026-04-25 (superseded original plan)
**Authority:** ADR-0009, AGENTS.md §Module Resolution
**Status:** Approved — ready for Phase 6-plan execution
