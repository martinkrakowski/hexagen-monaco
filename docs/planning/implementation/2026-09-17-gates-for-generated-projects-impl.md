# Gates for Generated Projects — Implementation Plan

**Date:** 2026-09-17
**Source plan:** `docs/planning/gates-for-generated-projects.md` (PR #678)
**Status:** ready to dispatch, with G1 rewritten — see §0
**Verified against:** `main` at `732e9591`
**Review:** two independent plan reviewers (Fable, grok-4.6), read-only, in a worktree at #678's head.
Every claim below was re-verified by the orchestrator against the code, not against either review.

---

## 0. What changed from the source plan, and why

The source plan's §0 says the `apps/` row "should decide the priority order". **That row rests on a
false premise, and both reviewers found it independently from different evidence.**

The plan says `apps/` goes unlinted because the linter _silently skips_ a context whose root does
not exist, and proposes emitting `.architecture/layout.yaml` to map `apps/`-rooted contexts. The
skip is real and genuinely diagnostic-free (`tools/arch-linter/src/cli.ts:682-684`). **It is not
why `apps/` goes unlinted.** Verified:

```
cli.ts:614-622   const modules = manifest.bounded_contexts ?? []    ← the only scan loop
manifest.ts:14   apps?: import("./apps.js").App[]                   ← a separate section
grep -rnE '\.apps\b|app\.yaml' tools/arch-linter/src → no matches   ← never read
.architecture/manifest.yaml → 31 bounded_contexts, 2 apps (web, tui)
```

`apps` are **not bounded contexts**. Nothing under `apps/` ever reaches `contextRootAbs`, so a
`layout.yaml` that maps "apps/-rooted contexts" maps an **empty set**. G1 as written ships a green
change that closes nothing — and it is the plan's top priority.

**G1 is therefore rewritten** around the decision that actually sits underneath it: _are apps lint
units?_ That is a manifest-schema and linter-scope change, not a layout mapping.

Three further corrections, each verified:

| #   | Correction                                                                                                                                                                                                                                                         | Evidence                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 1   | The `quality-gate` add-on emits `.prettierrc.json` (§2, `:195`, `:222`) while G-D4 has **core** emit it. Two producers, one path — the add-on lands as `.prettierrc.hexagen-update.json` (`conflict-path.ts:27-32`). **G2 and G3 are `SEQUENTIAL`, not parallel.** | source plan `:195`, `:222`   |
| 2   | The question manifest uses `choices`; the schema field is **`options`** (`question.ts:8-14`; every real manifest, e.g. `bullmq/manifest.json:13-15`). It would validate and render an empty select — `validateManifest` does not check the key.                    | `template-manifest.ts:54-86` |
| 3   | **G4 never references `pr-agent-review-replication.md`** (zero matches). G4 would ship generated projects the unfixed reviewer config that the sibling plan exists to fix. **G4 is `GATE`-blocked behind that plan's R1–R3.**                                      | source plan, grep            |

Also corrected: **46 real templates**, not 49 (`ls templates | wc -l` → 47 including `__example__`,
which `build-template-bundle.ts:32` reserves). The add-on-mechanism argument survives unchanged.

**Not corrected, flagged for the owner:** G-D2 defaults the coverage floor to `80` because `100`
"makes the first honest test-free commit red". That reason discriminates _off vs on_, not _80 vs
100_ — every floor above 0 does it on stubs emitted with `--passWithNoTests`
(`package-json.ts:83`). The number is a bare assertion. **Decide it before L3 dispatches.**

---

## 1. Work Plan Table

Per `.agents/ORCHESTRATOR.md` Step 3. Emitted before any sub-agent is instantiated.

| #   | Task                                                                                                    | Sub-Agent      | Scope (Package · Layer)                          | Mode         | Tag            | Depends On        |
| --- | ------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------ | ------------ | -------------- | ----------------- |
| 1   | Decide whether `apps` entries are lint units; record as an ADR                                          | Primary        | `.architecture/decisions/`                       | 🏗️ Architect | **GATE**       | —                 |
| 2   | Extend the manifest schema so an app declares a lintable root                                           | Domain Worker  | `@hexagen/sync` · Domain (`types/manifest/`)     | 🔨 Develop   | SEQUENTIAL     | 1                 |
| 3   | Teach the arch-linter to scan app units, and to **report** a skipped root instead of returning silently | Adapter Worker | `@hexagen/arch-linter` · Infrastructure          | 🔨 Develop   | SEQUENTIAL     | 2                 |
| 4   | Correct `findings/0001-layer-rules-skip-apps.md`: the mechanism is wrong on `main`                      | Primary        | `tools/arch-linter/findings/`                    | 🏗️ Architect | PARALLEL       | 1                 |
| 5   | Core emits a Prettier config beside the `format` script; drop `md` from the glob                        | Adapter Worker | `@hexagen/sync` · Infrastructure (`generators/`) | 🔨 Develop   | **SEQUENTIAL** | —                 |
| 6   | `quality-gate` add-on: workflow + coverage question, **no `.prettierrc.json`**                          | Adapter Worker | `template-engine/templates/quality-gate/`        | 🔨 Develop   | SEQUENTIAL     | 5                 |
| 7   | Emit-shape tests for `quality-gate`                                                                     | Test/QA Worker | `template-engine/__tests__/templates/`           | 🔨 Develop   | PARALLEL       | 6                 |
| 8   | `pr-reviewers` add-on                                                                                   | Adapter Worker | `template-engine/templates/pr-reviewers/`        | 🔨 Develop   | **GATE**       | replication R1–R3 |
| 9   | Quality Gate                                                                                            | Primary        | all packages                                     | 🔍 Review    | **GATE**       | 3, 4, 6, 7        |

**Why 5 is `SEQUENTIAL` with no dependency:** it writes the single `.prettierrc.json` that task 6
must _not_ write. Running them concurrently reintroduces the collision.

**Why 8 is `GATE`-blocked on another plan:** shipping the current reviewer config downstream
propagates the defect `replication.md` R1 fixes. A generated project would inherit an 18-to-1
noise generator.

---

## 2. Global Governance (inject verbatim into every sub-agent prompt)

```
[GLOBAL GOVERNANCE]
- ESM NodeNext: all imports within packages/sync/ require explicit .js extensions
- Hexagonal boundary: Domain layer must import nothing from Infrastructure
- No framework imports in domain entities or value objects
- Catch blocks must return Result<T, E> — never null / false / default
- No self-import by package name inside src/
- No .d.ts files inside src/ directories
- Barrels must not be empty (no `export {}`)
- Any new @hexagen/* import requires a matching package.json dependency update
```

Plus, for this plan specifically:

```
- The gate is: yarn build && yarn typecheck && yarn lint && yarn test
  PLUS yarn workspace <the package you touched> typecheck:test
  The second is not optional: typecheck excludes __tests__ by design, and CI's
  "Verify TypeCheck (test sources)" step (sync-integrity.yml:95) will catch what it misses.
- Never edit: generator.config.yaml, any dist/, any *.tsbuildinfo, src/**/*.d.ts,
  yarn.lock, turbo.json, .gitignore, packages/sync/tsup.config.ts
- A select question's field is `options`, never `choices` (question.ts:8-14).
- A template manifest has no `dependencies` or `scripts` field. An add-on cannot edit
  package.json, tsconfig.json or .architecture/* — collisions land as
  <name>.hexagen-update.<ext> (conflict-path.ts:27-32). If a task appears to need one,
  STOP and report: it is a core change, not an add-on.
```

---

## 3. Lanes

### L1 · GATE · Are apps lint units? (Primary, not delegated)

The blocker. `.architecture/manifest.yaml` carries 31 `bounded_contexts` and 2 `apps` (`web`,
`tui`); `tools/arch-linter` reads only the former. Two coherent answers:

- **(a) Apps become lint units.** The manifest gains a lintable root per app; the linter's scan
  loop unions `bounded_contexts` with `apps`. Largest blast radius; actually closes the hole.
- **(b) Apps stay out of scope, and the _claim_ is withdrawn.** `scripts/validate-ui-boundary.sh`
  (run at `lint.yml:243`) already covers `apps/web` narrowly. The finding is then re-scoped from
  "the linter skips apps" to "the linter does not cover apps, by design, and here is what does".

**This is an owner decision, recorded as an ADR before any code moves.** Do not let a lane pick.

### L2 · Report the skip (depends on L1)

Independent of (a)/(b): `cli.ts:682-684` returns on a missing root with **no diagnostic**. A gate
that skips silently is indistinguishable from a gate that passed — this repo's own rule
(`2026-08-23-enforcement-remediation-plan.md:35`) is that _a gate that has not been shown to fail
has not been shown to exist_. Emit a warning naming the module and the path it looked for.

**Shown-to-fail:** a manifest entry whose root does not exist produces a named warning; deleting
the warning turns a test red.

### L3 · Prettier config from core (no dependency; blocks L4)

`root-file-templates.ts:28` emits `format: prettier --write "**/*.{ts,tsx,md}"` and **no config**
(verified: no `.prettierrc*` anywhere in `packages/sync/src`, `templates/`, or
`project-generation/src`). A script without a config reformats to Prettier's defaults on first
run — campaign-foundry's pre-X1 state, where three PRs had real changes buried under churn.

Emit `.prettierrc.json` beside the script, and **drop `md` from the glob** (G-D5): the `.md` glob
would rewrap hand-wrapped prose.

**Shown-to-fail — and this is the correction Fable found:** it is not enough that a config exists.
The DoD is that **`yarn format` on a freshly generated project produces no diff**, which requires
the emitted sources to already conform to the width the config declares. Assert that in the
capstone fixture, or the lane can pass its own build and still fail its purpose.

### L4 · `quality-gate` add-on (depends on L3)

`quality.yml` + a `coverageFloor` **`options`** question. **Emits no `.prettierrc.json`** — L3 owns
that file.

**The coverage floor cannot be delivered as a pure add-on, and the source plan says so without
resolving it.** F6 is verified: a template manifest has no `dependencies`/`scripts` field, and an
add-on cannot edit `package.json` or a per-package `vitest.config.ts`. So a floor needs
`@vitest/coverage-v8` present and each config edited — neither of which an add-on can do. The
"sidecar merged by hand" in §2 is a checklist step, and under G-D6 a checklist step is not a gate.

**Resolve before dispatch, owner's choice:** (i) core emits the provider dependency and a coverage
block, and the add-on only sets the threshold; or (ii) the add-on ships the workflow **without** a
floor and the floor is deferred. Do not dispatch L4 until this is answered — as written,
`quality.yml` goes red for a missing provider, not for 79 % coverage.

### L5 · Correct the seeded finding (Primary)

`tools/arch-linter/findings/0001-layer-rules-skip-apps.md` is on `main` (`8d215446`) and its
**mechanism is wrong**: it describes "a context whose files live under `apps/`" falling back to a
nonexistent `packages/<module>` path. There are no such contexts — apps are not contexts. Its
repro cannot occur as written.

This record was reviewed twice by the orchestrator and passed both times, including one round that
_sharpened_ the mechanism and still missed it. Correct it to state the real scope boundary, and
carry the correction in the body rather than silently rewriting — the store's credibility rests on
findings being exact about mechanism, and this is its first component record.

### L6 · `pr-reviewers` add-on (GATE — blocked)

Blocked on `pr-agent-review-replication.md` R1–R3. Shipping today's config downstream propagates
the defect that plan exists to fix.

---

## 4. Definition of Done

`.agents/ORCHESTRATOR.md` Step 5, non-delegatable, run by Primary after all lanes report:

```
[ ] yarn build && yarn typecheck && yarn lint pass clean
[ ] yarn workspace <each touched package> typecheck:test passes
[ ] yarn lint:arch passes — no manifest violations
[ ] No Domain package imports an Infrastructure package
[ ] No port is declared in more than one bounded context
[ ] Every catch block returns Result<T, E>
[ ] Every context.yaml layers entry names a real exported symbol (ADR-0057)
[ ] Test doubles implement the exact same interface as the real adapter
[ ] No barrel contains only `export {}`
[ ] git diff --stat reviewed — no unintended reformatting
```

Plus, per lane: **every gate emitted must be shown to fail** (G-D6). L2 names its fault, L3 names
its fault, L4 names its fault. A lane that cannot produce a red run has not shipped a gate.

---

## 5. Open decisions — owner, before dispatch

1. **L1: are apps lint units?** (a) extend the schema and linter, or (b) withdraw the claim and
   re-scope the finding. Blocks L2 and L5.
2. **L4: how does the coverage floor reach a generated project?** Core provider + add-on threshold,
   or defer the floor. Blocks L4.
3. **G-D2: 80 or 100?** The stated reason does not discriminate between them.
