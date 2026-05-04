# ADR-0025: Unified Sync Engine — Single Source for Project Generation

**Status:** Accepted
**Date:** 2026-04-22
**Authors:** Architecture Co-pilot, Human Architect
**Supersedes (in part):** Scaffolding logic in `ExternalSyncEngineAdapter`
**Builds on:** ADR-0024 (sync-engine-manifest-first-compliance), ADR-0007 (barrel-generation-consolidation)

---

## Context

Prior to this ADR, the HexaGen Monaco codebase had two independent implementations
of "generate a monorepo":

1. **`SyncEngine`** (`packages/sync/`) — regenerated existing monorepos from
   `.architecture/manifest.yaml`. Produced ~30% of what a fresh project needed:
   layer folders, barrels, per-package `package.json` + `tsconfig.json`.

2. **`ExternalSyncEngineAdapter`** (~375 LOC, in `packages/project-generation/`) —
   wrapped `SyncEngine` for UI-driven generation. Handled the other ~70% via
   hardcoded templates in `root-files.ts`: root files, `.architecture/` content,
   app scaffolding, stub TypeScript files, ESLint configs, and a duplicate
   fallback barrel walker.

ADR-0024 restored the contract between `SyncEngine` and `manifest.yaml` for
the generators that already existed (package-json, tsconfig, barrels), but
did not touch the 70% of scaffolding that lived in the adapter. That gap is
what this ADR closes.

### Four concrete problems with the split

- **Stale barrels.** `engine.run()` fired before stubs were written. Barrels
  were emitted as `export {};` and did not re-export the stubs that existed
  alongside them. Generated projects required a post-extraction `yarn sync`
  run to be buildable. This directly contradicts the single-walker rule
  established in ADR-0007 — there is meant to be exactly one barrel generator
  and its output must be final.

- **Silent config ignore.** `monorepo.workspaceDefaults.packageJson` was not
  read by `generatePackageJson`, so UI-declared `package.json` defaults never
  reached generated projects. This is the same class of defect ADR-0024
  identified for `workspaceDefaults.tsConfig`, but on the adapter side.

- **Template drift.** Root-file templates in
  `packages/project-generation/src/infrastructure/adapters/root-files.ts`
  and hardcoded templates inside the engine (`generatePackageJson`,
  `generateTsconfig`) could diverge silently. Two sources of truth, no
  reconciliation.

- **Dual feature work.** Adding a new manifest field required parallel
  changes in both implementations. The maintenance burden scaled with every
  new scaffolding concern.

### Relationship to prior decisions

- ADR-0024 delivered manifest-first compliance for the generators that
  existed inside `SyncEngine`. It deliberately did not expand the generator
  surface. ADR-0025 expands that surface to cover everything the adapter
  did, keeping the same manifest-first contract.
- ADR-0007 consolidated barrel generation to a single recursive walker.
  The stale-barrel bug described above was a regression of that invariant
  — the adapter's independent fallback walker ran at the wrong phase.
  This ADR restores the single-walker discipline by moving all scaffolding
  behind the engine's pipeline ordering.
- ADR-0001 §composite-safety and ADR-0004 §paths-override define the
  protection semantics and `paths: {}` strategy that the unified pipeline
  must continue to honour — in particular, `.architecture/manifest.yaml`
  remains always-protected, and root `tsconfig.base.json` retains
  `paths: {}` for Node-style runtime resolution.

---

## Decision

Consolidate all scaffolding into `SyncEngine`. `ExternalSyncEngineAdapter`
becomes a ~40 LOC shell that invokes the engine and collects the output
tree.

### Canonical contract

1. **Every file in a generated project has manifest-declared provenance.**
   No hardcoded templates outside `packages/sync/src/generators/`. Built-in
   fallbacks inside generator modules are permitted and documented; the
   adapter has none.
2. **Self-regen and external modes share one pipeline.** The only
   differences are protection semantics (self-regen preserves hand-written;
   external starts from zero) and which cleanup steps run (self-regen does
   git check + rollback; external skips).
3. **Pipeline ordering guarantees barrel correctness.** Structural work
   (folders, root files) runs first; content work (package.json, tsconfig,
   stubs, apps, eslint) runs next; barrel regeneration runs **last**. Stubs
   land on disk before the barrel walker visits their directories. This
   eliminates the stale-barrel bug and reinstates the ADR-0007 invariant.
4. **Templates live in the manifest.** New manifest sections carry
   root-file, invariant, and stub templates. The generator reads them; it
   does not embed them. Interpolation uses a minimal `{variable}` helper;
   no Mustache/Handlebars dependency.

### Pipeline (three phases)

```
Phase 1 — Structure
  - generateRootFiles        (package.json, tsconfig.base.json, turbo.json)
  - generateArchitectureFiles (.architecture/**)
  - ensureLayerFolders        (packages/<bc>/src/<layer>/)

Phase 2 — Content
  - per bounded context:
      generateBarrels         (pass 1 — empty/layer stubs only)
      generatePackageJson
      generateTsconfig
      generateEslintConfig
      generateStubs           (writes manifest-declared element stubs)
  - generateApps              (apps/<name>/*)

Phase 3 — Barrels (SECOND PASS)
  - generateBarrels           (pass 2 — re-exports every stub that exists on disk)
```

The second barrel pass is the keystone: it re-enters every layer directory
after stubs have been written and regenerates barrels so each one
re-exports the files next to it. Generated projects are therefore
buildable immediately after extraction.

### New manifest sections (from Phases 1–5 of the execution plan)

- `generator.sync.stubs` — `{ enabled, templates, naming }` for per-element
  stub generation (entities, value objects, in/out ports, adapters,
  use-cases, domain services).
- `monorepo.rootFiles` — `{ packageJson.template, tsConfig (reuses
workspaceDefaults.tsConfig), turbo.template }`.
- `monorepo.archInvariants` — `{ layerRules.template,
linterConfig.template, generatorConfig.template }` for
  `.architecture/**` content.
- `apps[]` (populated) + `generator.sync.apps.frameworks` — template
  library keyed by framework (`next.js`, `fastify`, `plain-ts`).
- `monorepo.workspaceDefaults.eslint` — template merged into per-context
  ESLint configs through the same three-level cascade defined in ADR-0024
  (per-context override < workspace default < built-in fallback).

Every generator falls back to a built-in template when the corresponding
manifest section is absent. This preserves the current external-generation
behaviour for manifests that predate the new sections.

### Protection semantics (preserved from ADR-0001 §composite-safety)

- `.architecture/manifest.yaml` is **always protected** — never overwritten
  even with `--force-root`.
- `package.json`, `tsconfig.base.json`, `turbo.json` — protected without
  `--force-root` in self-regen; created fresh in external mode when the
  target is empty.
- Invariant YAMLs under `.architecture/invariants/` carry `@generated`
  markers so the engine can safely regenerate them when the marker is
  present and preserve them when it is not.
- The stub generator **never** overwrites an existing file, irrespective
  of markers. Every pre-existing file becomes a `skipped` result.

---

## Consequences

### Positive

- Stale-barrel bug fixed: stubs are guaranteed to be re-exported because
  the barrel walker runs after stubs land on disk. ADR-0007's single-walker
  rule is restored in effect.
- Generated projects are buildable immediately after extraction — no
  post-download `yarn sync` required.
- No more template drift: one source of truth lives in the manifest, one
  set of generator modules consume it.
- Feature additions happen in one place. Adding a new manifest-driven
  scaffolding concern now means one new generator + one new manifest
  section + one set of tests.
- `ExternalSyncEngineAdapter` reduces from ~375 LOC / 8 methods to ~40 LOC
  / 1 method (plus `collectFileTree`). The adapter's role becomes purely
  "invoke engine, collect output tree, wrap in `Project`".
- 250 sync tests pass (up from ~200 pre-Wave-5), including a new E2E
  fixture that confirms the full chain: manifest → engine → barrels
  re-exporting generated stubs.
- `monorepo.workspaceDefaults.packageJson` is now load-bearing (the
  silent-ignore defect is resolved).

### Negative

- The manifest is larger because templates are embedded. For long
  templates this is tolerable as YAML block scalars (`|`); if readability
  degrades, a follow-up can support `template: file://<path>` loading.
- Self-regen mass regen (ADR-0024 §Migration) is still pending. This ADR
  does not trigger it — the unified pipeline only activates new
  generators when the corresponding manifest sections are present, and
  hexagen-monaco's own `manifest.yaml` adopts them via the same PR.
- Built-in fallback templates inside generator modules are a second-tier
  source of truth. They exist only to cover manifests that predate the
  new sections; the invariant `generated-file-provenance` codifies that
  no template may live outside `packages/sync/src/generators/`.

### Related followups (filed for future work)

- **MCP server gap.** Write-tools for the `monorepo.workspaceDefaults`,
  `monorepo.rootFiles`, `apps[]`, and `generator.sync.stubs` sections are
  absent. Until they land, human architects edit these sections directly
  in `manifest.yaml`.
- **`fs-utils.ts` dry-run ordering.** `--dry-run` predictions are
  misleading because the dry-run branch fires before the protection
  check. Filed.
- **`fs-utils.ts` protected-files list incomplete.** Root `package.json`
  and `tsconfig.base.json` are not in the list; they should be added so
  protection semantics match this ADR's contract. Filed.

### Migration

- ADR-0025 lands in the same atomic PR as Phases 1–6 of the unified
  scaffolding plan (`docs/sync-engine-unified-scaffolding-plan.md`).
- No separate mass-regen is triggered by this ADR. ADR-0024's migration
  notes remain in force.
- Host repo tripwire: every new generator test uses temp-dir fixtures and
  must not mutate the real `hexagen-monaco` working tree.

---

## Related ADRs

- **ADR-0024** — Sync Engine Manifest-First Compliance (direct predecessor;
  this ADR completes it).
- **ADR-0007** — Barrel Generation Consolidation (origin of the
  single-walker rule; re-asserted by this ADR's Phase 3 ordering).
- **ADR-0001** — Persistence Wiring §composite-safety (protection
  semantics preserved for `manifest.yaml` and root tsconfigs).
- **ADR-0004** — CI Build: TypeScript Monorepo Resolution (`paths: {}`
  strategy unchanged; unified pipeline continues to honour it).
- **ADR-0002 / ADR-0003** — Sync Engine Reform and External Project
  Generation MVP (the original two-tier scaffolding split this ADR
  retires).
