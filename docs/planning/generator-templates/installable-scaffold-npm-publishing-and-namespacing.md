# Installable Scaffold: npm Publishing, CI Hardening & Project Namespacing

**Implementation branch:** `feature/installable-scaffold-publishing` (proposed) — split into a stack (see Sequencing).
**Status:** Proposed (v4 — **Item 0 route (b) chosen**: publish `@hexagen/arch-linter` as a co-released second package rather than inlining; dependent items updated)
**Relates to:** [14-ci-github-actions.md](./14-ci-github-actions.md), [11-env-setup.md](./11-env-setup.md), [engine-cleanup-and-wizard-followups.md](./engine-cleanup-and-wizard-followups.md), `.architecture/decisions/ADR-0009-published-cli-bundling.md`

---

## Revision note (what v1 got wrong)

Three reviews caught a **critical architectural error** in v1, verified against the code:

- **ADR-0009 mandates publishing only `@hexagen/sync`**, bundled via `tsup` (`packages/sync/tsup.config.ts:90` → `noExternal: [/^@hexagen\//]`; codified in `AGENTS.md:197`). v1's "publish six packages with aligned versions + Changesets dependency-ordering" **reversed an accepted ADR** and is dropped. Real Item 1 is ~0.5 day, not 1–2.
- **`@hexagen/arch-linter` exists** at `tools/arch-linter/` (v1 claimed it doesn't — I checked `packages/` and npm, not `tools/`). It has a `bin` (`hexagen-lint`) and `publishConfig`, but **no `private` field** → npm would publish it by default. And `hexagen arch validate` **shells out to it** (`packages/sync/src/manifest-service.ts:45` → `execAsync("yarn workspace @hexagen/arch-linter lint:arch")`), which **cannot work in a generated project** (no such workspace there). This is a pre-existing first-run blocker and gets a dedicated **Item 0**.
- **An existing `.github/workflows/publish.yml`** already publishes `shared` + `sync` + `arch-linter` with `sleep 10` / `yarn remove`+`add` hacks — itself inconsistent with the tsup-bundle decision. It must be reconciled, not duplicated.
- Several **namespace hardcode sites** were under-enumerated; they're now listed with `file:line`. (Note: `architecture-file-templates.ts` already uses `@{scope}/` — the infra is partly in place.)

The problem statement and the four workstreams stand; the _content_ of Items 1–4 is corrected below.

---

## Problem (unchanged, re-verified)

A project pushed to GitHub today cannot pass CI on first run — it cannot even `yarn install`:

1. Root `package.json` pins `@hexagen/sync@^0.1.0` (private, unpublished) and `@hexagen/arch-linter@^0.1.0` (exists but unpublished, wrong version) → install 404s.
2. No `yarn.lock` / `.yarnrc.yml` / `.gitignore` emitted → `yarn install --immutable` errors; **no `corepack` step** → the runner's default Yarn 1 can't honor `packageManager: yarn@4.12.0`.
3. Generated workspace packages squat `@hexagen/*` (`package-json.ts:32`, tsconfig paths) instead of the project's scope.
4. `ci.yml` runs `yarn check:env` unconditionally and ships a static `on:` block + hardcoded yarn with manual-edit comments.

**Definition of done:** generate a bare scaffold with a non-hexagen scope → push to GitHub → the initial Actions run is green, no manual edits.

---

## Prerequisites (verify before any code)

- **P1 — `@hexagen` npm org ownership.** Hard blocker for Item 1. `@hexagen/security@0.0.0` is already public, suggesting the org is held — **confirm publish rights**. _Fallback if unavailable:_ publish under an alternate scope (e.g. `@hexagen-monaco`) and thread that scope through `BUILTIN_PACKAGE_JSON_TEMPLATE`'s tooling devDep, the `prepare-publish-package.js` staging, and `publish.yml`. The tooling scope is a single constant — make it one.
- **P2 — Corepack vs `yarnPath` decision.** Determines `.yarnrc.yml` content and the CI install steps. **Recommend Corepack**: generated `ci.yml` runs `corepack enable` (mirroring the generator's own `sync-integrity.yml:25-28`), `packageManager` in `package.json` pins the version, `.yarnrc.yml` only sets `nodeLinker: node-modules`, and we do **not** commit `.yarn/releases/`. Simpler than pinning `yarnPath` + vendoring the binary.
- **P3 — ADR compliance.** Any deviation from "publish only `@hexagen/sync`" requires a superseding ADR. Item 0's arch-linter decision is the one place this is in tension — resolve it as an ADR amendment, not silently.

---

## Item 0 — Make `hexagen arch validate` work in a generated project (NEW, prerequisite)

### Why

Arch validation shells out to a separate `@hexagen/arch-linter` workspace from **two** call sites — `packages/sync/src/manifest-service.ts:45` _and_ `packages/sync/src/linter.ts:23`, both `execAsync("yarn workspace @hexagen/arch-linter lint:arch")`. In a generated project there is no such workspace, so `lint:arch` — wired into the scaffold's root scripts — is broken on every generated repo. Pre-existing; blocks first-run-green independently.

### Decision: route (b) — publish `@hexagen/arch-linter` as a co-released second package

Chosen over inlining (route a). Rationale:

- **Avoids the circular-import refactor.** `arch-linter/index.ts:13` does `import type { Manifest } from "@hexagen/sync"`; inlining would make that a self-import, forcing `Manifest` to relocate (a cross-package move touching _every_ importer of `Manifest` from sync). Route (b) sidesteps it entirely.
- **No `ts-morph` reconciliation.** Inlining would force sync's `^22.0.0` and arch-linter's `^27.0.2` onto one version — re-testing all of sync's AST features against a bumped `ts-morph`, or downgrading arch-linter's 27-API code. Route (b) keeps each on its own version.
- **ADR-0009's rationale doesn't forbid this.** That ADR targeted avoiding _six separately-versioned packages with inter-dep coordination_ — a distribution/versioning concern. arch-linter is a **devDependency** of generated projects, off the runtime path of everyday `hexagen sync`; a second package with a narrow purpose and its own `bin` (`hexagen-lint`) is a bounded, reasonable exception.
- **~1–1.5 day of straightforward work** vs ~2–3 days of risky refactoring — and this blocks the other five items.

**Cost (accepted):** version coordination between the two packages. **Mitigation:** co-release in `publish.yml` with a shared version bump; document them as co-released.

### What route (b) actually entails (some of this the a/b framing glossed)

1. **Bundle arch-linter for publish, like sync.** Its runtime imports include `mergeSplitManifest` from `@hexagen/project-configuration/server` — **private/unpublished**. So `@hexagen/arch-linter` needs the **same `tsup` treatment** (`noExternal: [/^@hexagen\//]`) to inline its private `@hexagen/*` deps (`project-configuration`, `shared`); its third-party deps (`ts-morph@^27`, `chalk`, `lodash`, `js-yaml`, `zod`) stay as normal published `dependencies`. Without this, `npm install @hexagen/arch-linter` 404s on `@hexagen/project-configuration`.
2. **The `Manifest` type import stays put.** `import type { Manifest } from "@hexagen/sync"` is **type-only → erased at build**, so it does not pull sync into the bundle and creates no runtime cycle. **Verify** esbuild/tsup drops it (it should for `import type`); relocating `Manifest` to `@hexagen/project-configuration` is the _fallback_ only if a value-level edge survives.
3. **Fix both shell-out sites to invoke the installed bin, not `yarn workspace`.** In a generated project `yarn workspace @hexagen/arch-linter lint:arch` can't work; resolve and run the published **`hexagen-lint`** bin from `node_modules` (PM-agnostic — resolve the bin path / `npx hexagen-lint`), at `manifest-service.ts:45` and `linter.ts:23`.
4. **Scaffold wiring:** root `package.json` adds `@hexagen/arch-linter@<co-release version>` as a devDependency; the `lint:arch` script invokes `hexagen arch validate` (which now resolves the installed bin).
5. **Publish setup:** flip `tools/arch-linter` `private` (currently **absent** — npm would publish it by default; set it deliberately and add/confirm `publishConfig.access: public`), give it a `prepare-publish` pass (parameterize `prepare-publish-package.js` or add a second invocation), and add an ordered, shared-version publish step to `publish.yml`.
6. **Emitted linter-config headers stay.** `architecture-file-templates.ts:48,63` emit `# Rules for @hexagen/arch-linter` — under route (b) that name is **correct**, so **leave it** (this reverts the route-(a) note that said to change it). Note: this is a _comment_, distinct from `architecture-file-templates.ts:96`'s `@hexagen/*` invariant which still becomes `@{scope}/*` per Item 4.

### Mandatory pre-work

`grep -rn "arch-linter\|lint:arch" packages tools` across shell calls, package scripts, and test fixtures — enumerate every site the bin-invocation change touches; include the list in the ADR amendment.

### ADR amendment

Short amendment to ADR-0009: `@hexagen/arch-linter` is published as a **co-released second package** (shared version with `@hexagen/sync`), a bounded exception justified by its devDep-only, off-runtime-path role. Reference the pre-work file list.

### Acceptance

- In a freshly generated project (outside the monorepo) with `@hexagen/arch-linter` installed, `yarn hexagen arch validate` (or `lint:arch`) runs and reports with **no `yarn workspace` / `execAsync` failure**.
- `npm install @hexagen/arch-linter` from a clean dir resolves with **zero `@hexagen/*` 404s** (private deps inlined via tsup).
- `tools/arch-linter/package.json` has an explicit `private`/`publishConfig` decision (not the current undefined `private`).

---

## Item 1 — Publish `@hexagen/sync` (ADR-0009 compliant)

### What actually publishes

**Only `@hexagen/sync`.** `tsup` inlines the `@hexagen/*` workspace graph into a self-contained ESM bundle; third-party deps (`commander`, `js-yaml`, `ts-morph`) stay external and are declared in the published `dependencies` (so `npm install @hexagen/sync` pulls them). The 5 workspace deps are **not** published.

### Changes

- **Flip `private: true → false` on `@hexagen/sync` only.** Audit its existing `publishConfig` block (registry, access) — ensure `access: public`, no stale registry override.
- **Reuse / repair the existing publish pipeline**, don't add a parallel one:
  - `scripts/prepare-publish-package.js` already stages the publish manifest (strips `workspace:*`). **Verify it produces a manifest whose `dependencies` are only the external npm deps** — any surviving `@hexagen/* workspace:*` (or rewritten-to-version private packages) means a 404 on consumer install. Add a `--dry-run` pack assertion to CI that greps the packed `package.json` for `@hexagen/` and fails if present.
  - **Reconcile `.github/workflows/publish.yml`:** today it publishes `shared` + `sync` + `arch-linter` with `sleep 10` and `yarn remove/add` rewrites. Under ADR-0009 it should publish **only the bundled `@hexagen/sync`** (plus arch-linter _iff_ Item 0 chooses route (b)). Remove the `shared` publish + propagation hacks; replace `sleep` with a registry-poll/retry if any cross-package wait remains.
- **`prepare-publish-package.js` — target staged-manifest spec (not just "audit").** After staging, the published `package.json` must be exactly: `bin: { "hexagen": "./dist/cli.js" }`, `main: "./dist/index.js"`, `types: "./dist/index.d.ts"`, `exports` matching the source map (with a `types` condition), `dependencies` = `{ commander, js-yaml }` only (the two `external`s — **no `workspace:*`, no `@hexagen/*`, and `ts-morph` removed** per the bundled-only decision), plus `engines`/`repository`/`homepage`/`bugs`. The PR states the diff from what the script produces today so the reviewer checks a delta, not the whole script.
- **Build correctness (shebang — verify, don't double):** `cli.ts` source **already starts with `#!/usr/bin/env node`**, and tsup preserves shebangs + marks the output executable by default. So the task is to **verify the packed `dist/cli.js` retains the shebang and +x** (`npm pack` → inspect the tarball) — **do not add a `banner`**, which would emit a duplicate shebang. The current `tsup.config.ts` has no explicit banner/chmod, which is _fine if tsup's built-in handling fires_; the verify step confirms it does. Also confirm `bin`/`main`/`types`/`exports` resolve to `dist`. Add `"engines": { "node": ">=20" }` and `repository`/`homepage`/`bugs`.
- **`noExternal` covers ts-morph implicitly?** `noExternal: [/^@hexagen\//]` matches only `@hexagen/*`; `ts-morph` is neither in `external` (`["commander","js-yaml"]`) nor matched by `noExternal`. tsup's default is to bundle anything not `external`, so `ts-morph` **is** inlined today — which is exactly why moving it to `devDependencies` (and out of published `dependencies`) is safe. **Verify** with a `npm pack` whose bundle contains ts-morph and whose manifest `dependencies` are only `commander`+`js-yaml` — one check, stated in the PR (a `ts-morph` missing from _both_ bundle and deps would be a runtime crash).
- **Provenance (release job only):** `npm publish --provenance` needs job-level `permissions: { id-token: write, contents: read }` — verify both are on the publish job, not merely top-level. The generated `ci.yml` needs neither (it doesn't publish).
- **`ts-morph` packaging hygiene (decided).** sync inlines `ts-morph` (~30 MB with `@ts-morph/common`) via the bundle — but it's currently **both** inlined (`noExternal`) **and** listed in published `dependencies`, so a consumer redundantly installs another ~30 MB into the scaffold's `node_modules` (slower CI install). **Decision (bundled-only):** move `ts-morph` to **`devDependencies` in sync's source `package.json`**, confirm `tsup` still inlines it (it bundles regardless of dep type), and confirm `prepare-publish-package.js` doesn't re-add it to the staged `dependencies`. Net published `dependencies` = `commander`, `js-yaml` only. _(Route (b) means sync does **not** gain arch-linter's `lodash`/`zod`/`chalk` — those live in the separately-published `@hexagen/arch-linter`.)_
- **Reconcile `publish.yml` `sleep` hacks:** with a single published package the inter-publish `sleep 10` waits are simply deleted; only route (b) (two packages) keeps an ordered publish, and there the `sleep` becomes a registry-poll/retry, not a fixed sleep.

### rc bootstrap ordering (resolve the circularity)

The capstone (Item 5) runs `yarn install` in a generated scaffold that pins `@hexagen/sync` — so the **rc must be published _before_ the capstone can run**. Sequence: **publish `X.Y.Z-rc.1` → run capstone against the rc → promote to stable.** Stable promotion is gated on the capstone; the rc publish is not.

### Acceptance

- `npm view @hexagen/sync version` resolves; `npx @hexagen/sync@<rc> --help` runs from an empty dir with **zero** `@hexagen/*` install fetches (everything inlined except the declared third-party deps).

---

## Item 2 — CI hardening

| Gap                                                           | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No `corepack`** → Yarn-4 unusable in CI (first-run blocker) | Use the **explicit prepare form** (decided): `corepack enable` then `corepack prepare yarn@<version-from-packageManager> --activate`, before any yarn step in the generated `ci.yml` and deploy workflows — `enable` alone doesn't guarantee the runner fetches the exact Yarn the local install used. Mirror `sync-integrity.yml:25-28`.                                                                                                                                                                                                                                                                                                                                                                           |
| `@hexagen/arch-linter` devDep (wrong/unpublished)             | Per Item 0 route (b): **pin the co-released published `@hexagen/arch-linter`** (same version as `@hexagen/sync`); `lint:arch` → `hexagen arch validate`, which resolves the installed `hexagen-lint` bin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `@hexagen/sync@^0.1.0` wrong/unpublished                      | Pin to the published version from Item 1 (e.g. `^0.4.0` / the rc).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| No lockfile → `--immutable` fails                             | Drop `--immutable` for first run (plain `yarn install`). **Re-enablement specified:** (1) emit a `# add --immutable once you commit yarn.lock` comment in `ci.yml` — **acknowledged exception** to this plan's "no manual-edit comments" goal; optional follow-up: a later `hexagen sync` run detects a committed `yarn.lock` and patches the workflow to add `--immutable` automatically; (2) the post-generate checklist (below) tells the user to run `yarn install` locally and commit `yarn.lock`. Do **not** auto-commit from CI (noise + write-perms). PM-aware: `npm ci` is immutable by nature, `pnpm install --frozen-lockfile` is the equivalent — the emitted comment/commands follow `packageManager`. |
| No `.gitignore` / `.yarnrc.yml`                               | Emit root `.gitignore` (`node_modules`, `dist`, `.turbo`, `.next`, `.env*`, coverage) and `.yarnrc.yml` (`nodeLinker: node-modules`, per P2/Corepack) in `root-files.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `yarn check:env` unconditional                                | Emit the step **conditionally at generation time** (Item 3's dynamic emission) only when `env-setup` is selected — preferred over a runtime shell guard. Reclassify env-setup in `14-ci-github-actions.md` from a **Required** dependency to **Soft/Optional** (it conflicts with the "CI works without it" position).                                                                                                                                                                                                                                                                                                                                                                                              |
| "turbo build exits 0 on empty workspace" assumed              | Smoke test (spec'd): generate a zero-bounded-context manifest, run `yarn build` in a subprocess, **assert exit 0**; pin the Turbo version so behavior is stable across releases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Post-generate checklist (specified location)

Emit a **`SETUP.md`** at the scaffold root (and a one-line pointer in the generated `README.md`) with the first-push steps: `corepack enable` → `yarn install` → **commit `yarn.lock`** → push. A file (not a printed generate-time message) so it survives for a user who pushes without reading terminal output. Two notes to include in it: (1) the `corepack prepare yarn@<v>` line in `ci.yml` **bakes the Yarn version at generate time** — if you upgrade your package manager (`packageManager` field), update that line too; (2) `SETUP.md` is a **one-time bootstrap doc — delete it after the first push** (its `--immutable`-not-yet-enabled guidance goes stale once `yarn.lock` is committed). Reviewable as part of the PR.

### Acceptance

- In a freshly generated bare scaffold: `corepack enable && yarn install && yarn build && yarn typecheck && yarn lint && yarn test` all exit 0 locally.
- `SETUP.md` exists at the scaffold root and names the lockfile-commit step.

---

## Item 3 — Fully dynamic workflow YAML

`ci.yml` records answers in comments but emits a static `on:` + hardcoded yarn. Drive the YAML from answers via **precomputed composite tokens** — but the reviews are right that naive interpolation breaks YAML, so the strategy is specified:

### Interpolation safety (mandatory)

- **No empty-string steps.** An omitted step (e.g. `run_tests: false`) must remove the whole block cleanly — never `- ""` or a blank list item. Implement by **building the `steps:` list as an array of present step-strings and joining**, not inline `{token}` holes in a fixed `steps:` literal. **Owner:** a new pure builder **`buildCiWorkflow(answers, packageManager, selectedTemplates: string[]): string`** in the `ci-github-actions` template's render layer (alongside the manifest, e.g. `templates/ci-github-actions/render.ts`), unit-tested directly — not logic smeared into the engine. The explicit `selectedTemplates` param settles the `{env_check_step}` question at the signature level: the builder always _has_ the selected set, so it gates the env-check on `env-setup ∈ selectedTemplates` deterministically (no runtime shell-guard, no "is the info available?" surprise). The template file becomes a thin shell the builder fills.
- **Indentation.** Multi-line fragments are emitted **pre-indented to the target column**; the builder owns indentation since it assembles the array. (The engine's `interpolate()` is plain string-replace with no indentation awareness — don't rely on it for blocks.)
- **Validity test — bounded, enumerated here.** Full cross-product (triggers × run_tests × deploy × cache × pm ≈ 180) is impractical; use this **fixed set of 8** (every option value covered ≥once; pairwise on the high-risk pairs). Each is parsed with `js-yaml.load()` and asserted error-free, plus the existing `ci-github-actions-emit-shape` test:
  1. `yarn, push-all-branches, tests=true, cache=turbo, deploy=none`
  2. `yarn, push-main-only, tests=false, cache=yarn, deploy=none`
  3. `yarn, manual-only, tests=true, cache=node-modules, deploy=none` _(no concurrency block)_
  4. `npm, push-main-only, tests=true, cache=npm, deploy=vercel`
  5. `pnpm, pull-request, tests=true, cache=turbo, deploy=none`
  6. `npm, [push-main-only, pull-request], tests=false, cache=npm, deploy=fly-io`
  7. `pnpm, manual-only, tests=false, cache=pnpm, deploy=none`
  8. `yarn, [push-main-only, manual], tests=true, cache=turbo, deploy=railway`

### Tokens & package-manager mapping

`{node_version}` stays as-is. The package-manager-derived values are a **table, not a single `{pm} install`** (the commands genuinely differ):

|                              | yarn (4)                                                  | npm           | pnpm                                                      |
| ---------------------------- | --------------------------------------------------------- | ------------- | --------------------------------------------------------- |
| corepack                     | `corepack enable && corepack prepare yarn@<v> --activate` | _(none)_      | `corepack enable && corepack prepare pnpm@<v> --activate` |
| install (first run)          | `yarn install`                                            | `npm install` | `pnpm install`                                            |
| install (lockfile committed) | `yarn install --immutable`                                | `npm ci`      | `pnpm install --frozen-lockfile`                          |
| run script                   | `yarn <s>`                                                | `npm run <s>` | `pnpm <s>`                                                |
| setup-node cache             | `cache: yarn`                                             | `cache: npm`  | `cache: pnpm`                                             |

`packageManager` is validated against `^(yarn|npm|pnpm)@\d` before threading. **Minimum viable:** yarn-4 correctness (the generator's default); npm/pnpm columns are the documented target but can land in a follow-up if scope-limited — state which in the PR.

- `{on_block}` from `ci_triggers`. **Conditional `concurrency` rule (explicit):** emit the `concurrency` block **only** when a non-manual trigger is present (push/PR); for `manual`-only, omit it (so a `workflow_dispatch` run isn't cancelled by unrelated ref activity).
- `{test_step}` only when `run_tests`.
- `{env_check_step}` only when `env-setup` is selected — **resolved, not open:** confirm during implementation whether the `ci-github-actions` render context receives the full selected-template set. If yes, gate emission on it (preferred). If no, the **definitive** approach is the generation-time-omit driven by the same answer the catalog already threads for companion/requires resolution; do **not** ship the runtime shell-guard. State the confirmed answer in the PR; don't leave both paths live.
- `{cache_block}` is **conditional step emission, not a value swap** — `turbo-cache` (actions/cache on `.turbo`), `yarn-cache`, and `node-modules` use different actions/paths/keys; the builder emits the full step string per strategy.

### Deploy / preview workflows (enumerated)

`deploy-vercel.yml` (and railway/fly/vps, preview.yml) hardcode `yarn install --immutable`, `cache: "yarn"`, `node-version: {node_version}`. Apply: `corepack`, `{pm_install}` (drop `--immutable`), package-manager-aware cache, node version. List each file + its tokens in the implementing PR.

### Don't forget

- **Add the `package_manager` question to `ci-github-actions/manifest.json`.** The planning doc `14-ci-github-actions.md:19` lists it as an `auto` question ("from project"), but it's **absent from the actual `manifest.json`**. Add it as an `auto` question deriving from the project's `packageManager` (the auto/derivedFrom mechanism), default `yarn`, so the tokens have a source.
- Manifest/question changes here require regenerating `apps/web/.../template-questions.generated.ts` (`yarn workspace web gen:template-questions`); the CI parity check (`check:template-questions`) must pass.

### Acceptance

- `ci_triggers: [push-main-only]`, `run_tests: false`, `deploy_target: none` → a `ci.yml` whose `on:` is `push: { branches: [main] }`, **no** test step, **no** deploy file, parses clean under `js-yaml`, with `corepack` present.

---

## Item 4 — Project namespacing (stop squatting `@hexagen/*`)

`root-files.ts` computes `scope` (`manifest.scope` → `system` → `"generated-project"`) but it isn't threaded everywhere. **Exact sites (verified):**

| Site                                                                          | Current                                                                           | Change                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package-json.ts:32`                                                          | `name: \`@hexagen/${moduleName}\``                                                | `@${scope}/${moduleName}`                                                                                                                                                                                                                                                                                                              |
| `root-file-templates.ts` tsconfig `paths`                                     | `"@hexagen/*"`                                                                    | `"@{scope}/*"` (interpolate)                                                                                                                                                                                                                                                                                                           |
| `apps-framework-templates.ts:8,53,102`                                        | `@{system}/{appName}`                                                             | **`@{scope}/{appName}`** — see system-vs-scope note below (this is a deliberate unify, possibly behavior-changing)                                                                                                                                                                                                                     |
| **`types/manifest/helpers.ts:47`** (the real **source**)                      | `` `@hexagen/${name}` `` inside `expandDependsOn(context)` — **no `scope` param** | **DI change**: add `scope` to `expandDependsOn(context, scope)` (or have it return bare names and prepend `@${scope}/` in callers). Thread `scope` through both call sites — `package-json.ts:27`, `tsconfig.ts:121`. This is the harder fix the v2/v3 "tsconfig.ts" note was pointing at; **estimate reflects DI, not a regex swap.** |
| `tsconfig.ts:122`                                                             | `pkg.replace(/^@hexagen\//, "")` (a **consumer** of the above)                    | strip `@${scope}/` once the helper produces scoped names.                                                                                                                                                                                                                                                                              |
| `architecture-file-templates.ts:96` (in `GENERATOR_CONFIG_TEMPLATE`)          | `"Every @hexagen/* import must have a matching entry…"`                           | **`@{scope}/*`** — **resolved, not audit**: this template _is_ emitted into projects (`architecture-files.ts:255-261` via `interpolateWithLogging`, which already passes `scope`), so the `{scope}` token interpolates. Change it.                                                                                                     |
| `architecture-file-templates.ts:48,63`                                        | `# Rules for @hexagen/arch-linter` headers (emitted)                              | change per Item 0 (route a → `hexagen arch validate` / `@hexagen/sync`). Cross-ref Item 0.                                                                                                                                                                                                                                             |
| `eslint.ts:177-183`                                                           | already reads `config.manifest.scope` ✓                                           | **no change — reference implementation** for how to thread `scope` into `package-json.ts` / the helper.                                                                                                                                                                                                                                |
| Tests: `package-json.test.ts:8,66-93`; `ci-github-actions-emit-shape.test.ts` | assert `@hexagen/...`                                                             | update to the scoped expectation                                                                                                                                                                                                                                                                                                       |

### system vs scope (resolve the semantics)

`root-files.ts` derives `scope` from `manifest.scope`, falling back to `system`. App templates currently use `@{system}/`, lib packages hardcode `@hexagen/`. Decide and document: is `system` a distinct manifest field (project identity) while `scope` is the npm namespace, or are they aliases? **Recommended:** `scope` is the single source for _all_ package names (apps + libs); `system` stays the human/project identifier but no longer drives package scope. For existing generated projects that set only `system`, the fallback (`scope = system`) preserves today's names — so this is **non-breaking** as long as the fallback stays. Spell this out so it's a deliberate merge, not an accidental rename.

### Scope sanitizer (self-contained, per repo convention)

**Reimplement** the npm-scope rules inline (this repo's convention is not to assume libraries exist; don't add `validate-npm-package-name` as a dep): strip a leading `@`, lowercase, replace illegal chars with `-`, collapse consecutive `-`/`.`, trim to ≤214 chars; reject empty → fall back to a **slugified project name** (not the literal `"generated-project"`). One centralized function with unit tests covering the spec edge cases. Add a wizard field "Package scope / npm org" with a live `@scope/<pkg>` preview; persist to `manifest.scope`.

### Guard test (two-sided, precise exception)

For a project generated with scope `acme`: **(1)** no emitted _project_ file contains `@hexagen/` except the **allowlisted tooling devDeps in the root `package.json`** — `["@hexagen/sync", "@hexagen/arch-linter"]` (both co-released tooling packages per Item 0 route (b); keep it a named allowlist constant, not hardcoded strings); `@hexagen/` anywhere in project _source_/packages still fails. **(2)** `@acme/` appears in package names + tsconfig paths + project references. (One-sided would pass a bug that drops all scopes.)

### Acceptance

- Scope `acme` → `@acme/<m>` package names, `@acme/*` tsconfig alias + project references, internal deps `@acme/*`; `@hexagen/` only as the `@hexagen/sync` tooling devDep.

---

## Item 5 (capstone) — First-run-green test

- **Primary (automated, deterministic):** a local harness that generates a bare scaffold with a non-hexagen scope + `ci-github-actions`, then runs the `ci.yml` command sequence in a subprocess and asserts **all exit 0**, plus: no `@hexagen/` in project files (outside the `@hexagen/sync` devDep), and every emitted workflow parses under `js-yaml`. **Resolve the "no network vs `yarn install`" contradiction:** the scaffold pins `@hexagen/sync`, which `yarn install` would fetch from the registry. Make it hermetic by **packing `@hexagen/sync` locally** (`yarn pack` / `npm pack` → `.tgz`) and overriding the scaffold's dep for the harness run. **Definitive form (Yarn 4):** a `resolutions: { "@hexagen/sync": "file:../<path>/hexagen-sync-<v>.tgz" }` entry in the harness scaffold's `package.json` — more reliable than a bare `file:`/`portal:` dependency, which under `nodeLinker: node-modules` can mis-hoist the tarball's transitive deps. Note in the PR that this was actually exercised, not assumed. The fast unit slice (no-`@hexagen` assertion + `js-yaml` validity) runs in <30s. **Decision: one sequential job, not split** — the capstone runs rarely (not per-commit), so a single offline job (`corepack enable` → pack `@hexagen/sync` → install via the `resolutions` tarball → build/test) is simpler than artifact-passing between jobs and avoids a second corepack setup. Before the install step, the harness runs `yarn install --mode=skip-build` / `yarn info @hexagen/sync` (or a `--dry-run`) to confirm the tarball + its `commander`/`js-yaml` deps resolve cleanly under `nodeLinker: node-modules` — caught early rather than as a mid-run failure.
- **Generator-CI prerequisite:** the harness runs `corepack enable` in a subprocess, so the generator repo's own CI must have Corepack available (Node ≥16.9 / `corepack enable` step). Confirm `sync-integrity.yml` provides it before wiring the harness into CI.
- **Secondary (manual, pre-release only):** one real push to a throwaway repo via `GitHubExporterAdapter`, eyeball the green Actions run. Not an automated test (flaky, network/secret-bound).
- **Only after this passes** do we build the originally-requested export-dialog "include CI" checkbox (the downstream feature this whole plan unblocks) and promote the `@hexagen/sync` rc to a stable release.

---

## Sequencing

1. **Item 0** — fix `hexagen arch validate` (+ ADR amendment, `private` on arch-linter). Unblocks everything; pre-existing bug.
2. **Item 4** — namespacing (pure generator change, no npm dependency).
3. **Item 2** — CI hardening (corepack, lockfile, `.gitignore`/`.yarnrc.yml`, conditional env-check).
4. **Item 1** — publish `@hexagen/sync` (rc), reconcile `publish.yml`. Gated on P1 org ownership.
5. **Item 3** — dynamic YAML.
6. **Item 5** — capstone; promote rc → stable; then the export-CI checkbox.

Items 0/4/2 need no npm org and can start immediately; Item 1 runs in parallel once P1 is confirmed. **Item 0's ADR amendment may need team consensus** — Items 4 and 2 (which don't depend on the arch-linter route) proceed independently while that review is open, so the ADR cycle isn't on the critical path for them.

---

## Risks & trade-offs

- **ADR tension (Item 0).** Inlining arch-lint (route a) is the clean ADR-0009 outcome; publishing arch-linter (route b) needs an explicit amendment. Decide before coding.
- **Lockfile-less first run.** Non-deterministic until the user commits the first `yarn.lock`; mitigated by the post-generate checklist + `--immutable` comment. CI won't catch lockfile drift until then — documented.
- **Public CLI surface.** `@hexagen/sync` becomes a supported contract; semver discipline via the existing pipeline. Pre-release until capstone green.
- **org ownership unknown** (P1) — possible hard block with no fixed duration; fallback scope defined.
- **Existing `publish.yml` over-publishes** (shared/arch-linter) and uses `sleep` hacks — reconciling it is in-scope to avoid two conflicting pipelines.

---

## Estimated effort

- Item 0 (route (b)): **~1.5 days** — tsup-bundle `@hexagen/arch-linter` (inline its private `@hexagen/*` deps), fix the two bin-invocation sites, set `private`/`publishConfig`, `prepare-publish` pass + co-release step in `publish.yml`, scaffold devDep wiring, ADR amendment. No `Manifest` relocation, no `ts-morph` reconciliation.
- Item 4 (namespacing, ~6 sites + sanitizer + tests): ~1–1.5 days.
- Item 2 (CI hardening + corepack + smoke test): ~1 day.
- Item 1 (publish only sync; repair publish.yml; rc): ~0.5–1 day (excl. org-ownership wait).
- Item 3 (dynamic YAML + js-yaml validity matrix + deploy files): ~1.5 days.
- Item 5 (capstone harness): ~0.5 day.

~5.5–6.5 days + org-verification and ADR-amendment lead time; 5–6 stacked PRs (Item 0 and Item 1's `publish.yml` change kept auditable on their own).
