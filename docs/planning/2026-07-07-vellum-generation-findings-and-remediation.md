# Generator Findings from the Vellum Project — Remediation Plan

**Date:** 2026-07-07
**Status:** Proposed
**Source:** Full lifecycle of a freshly generated project (`vellum`,
github.com/martinkrakowski/vellum) — from first `yarn install` through a
working MVP with 17 bounded contexts, verified live in a browser. Every
finding below was hit in practice; none are theoretical. The Vellum repo's
baseline commit preserves the scaffold exactly as generated, and its PR stack
(#6–#10) shows the fix for each finding in context.

Component attributions (`project-generation`, `sync`, `architectural-
enforcement`, `template-engine`, `manifest-generation`) are best-guess from
package names — confirm ownership before scheduling.

---

## The headline recommendation: a generate-then-gate E2E harness

Nearly every P0/P1 finding below would have been caught by one CI job:

```
hexagen generate <fixture-config> into a temp dir
cd there && corepack enable
yarn install                      # F1 fails here
yarn build                        # F2, F5, F7 fail here
yarn lint                         # F4 fails here
yarn typecheck && yarn test
yarn lint:arch                    # F10 fails on first real cross-context import
git init && git add -A            # F3 detectable here (count staged .env files)
yarn sync:check                   # F11/F12/F19 detectable via non-zero ops
```

Run it per PR with 2–3 fixture manifests (single-app, modular-monolith with
15+ contexts, monolith + several templates). A scaffold that cannot pass its
own toolchain is the product failing its acceptance test — everything else in
this plan is detail. **Do this first; it converts every fix below into a
regression test.**

**Caveat — the bare-command harness has a blind spot.** It runs the toolchain
_directly_, so it will not catch bugs in the **generated CI workflows** (F21) —
the vellum CI was red on the first push for a reason none of the commands above
reproduce locally. The harness must also validate the emitted `.github/
workflows/*.yml`: at minimum lint + a schema/`actionlint` pass, and ideally a
real push of one fixture to a throwaway repo (or `act`) so the workflow's step
_ordering_ is exercised, not just its individual commands. Local-green +
CI-red is the worst failure mode because it ships looking fine.

---

## P0 — Broken out of the box (install or build fails)

### F1. devDependency pins reference unpublished versions

`package.json` pinned `@hexagen-monaco/sync` and `@hexagen-monaco/arch-linter`
at `^0.8.1`; npm's latest is `0.8.0`. `yarn install` fails at resolution —
the very first command a user runs.
**Fix:** the generator must stamp the _currently published_ version (query the
registry or embed at release time), never a hardcoded future version. The E2E
harness catches any recurrence.
**Component:** project-generation / release tooling.

### F2. Package tsconfigs: `rootDir: "src"` with no `include`

Every package's `vitest.config.ts` (package root) is swept in by the default
`**/*` include and `tsc` fails with TS6059. Bonus damage: the failed build
emits `vitest.config.d.ts` + `.map` at the package root before dying.
**Fix:** emit `"include": ["src"]` in the workspace tsconfig template
(`workspaceDefaults.tsConfig`).
**Component:** project-generation (workspace template).

### F3. `.gitignore` silently excludes shipped env templates

Rules: `.env.*` + `!.env.example`. The scaffold itself ships eight
`.env.<template>.example` files — all silently excluded from the first commit.
Users lose generated reference files without any signal.
**Fix:** add `!.env.*.example` to the emitted .gitignore (and to
`.gitignore.hexagen`).
**Component:** project-generation.

### F21. Generated CI workflow orders `setup-node` before Corepack → red on first push

The emitted `.github/workflows/ci.yml` runs `actions/setup-node@v5` **before**
`corepack enable`. setup-node@v5 auto-detects the committed lockfile and probes
the package-manager cache by invoking the runner's **global Yarn Classic
(1.22)** (`yarn cache dir`) — which hard-errors on a `packageManager:
"yarn@4.x"`-pinned project:

```
error This project's package.json defines "packageManager": "yarn@4.12.0".
However the current global version of Yarn is 1.22.22.
```

Result: **CI fails on the very first push** — the first thing anyone does after
generating. Local `yarn install/build/test` all pass, so nothing surfaces it
until the push, and the bare-command E2E harness above would miss it entirely.

Two things make this a sharp finding, not just a bug:

1. **The template's own comments already described the hazard** — the emitted
   YAML carried a paragraph explaining that setup-node's yarn-cache probe runs
   global Yarn Classic before Corepack activates yarn@4 — and then emitted the
   steps in exactly that broken order anyway. Same disease as F10/F15: the
   generator _documents_ the correct behaviour while _emitting_ the wrong one.
2. **The mitigation it chose was insufficient.** Omitting `cache: yarn` is not
   enough on setup-node@v5, which still probes. The fix needs both: Corepack
   enabled **first**, and the probe disabled explicitly with
   `package-manager-cache: false`.

Note the generator already ships one workflow that gets this right —
`sync-integrity.yml` enables Corepack before setup-node — so the two emitted
workflows contradict each other. Whatever produced the correct ordering there
should be the single source for all workflow templates.

**Fix:** in every emitted workflow that runs the package manager, order
`corepack enable` before `actions/setup-node`, set `package-manager-cache:
false` (or a post-Corepack `actions/cache` step), and switch install to
`--immutable` once a lockfile is committed. Add `actionlint` + a real
push/`act` run to the harness (see the headline caveat) so step-ordering
regressions are caught.
**Component:** project-generation (ci-github-actions template).

---

## P1 — First-hour failures (the default gate is red or lies)

### F4. Generated port stubs fail the generated lint config

`interface XxxPort {}` stubs trip `@typescript-eslint/no-empty-object-type`
in every package that gets one → `yarn lint` red on a pristine scaffold. The
generator's two halves (stub emitter, eslint config) disagree.
**Fix (pick one):** emit stubs with a single-line disable + TODO naming the
decision; or emit a placeholder member (`__brand?: never`); or configure
`allowInterfaces: 'always'` scoped to `*.{in,out}-port.ts` files only.
**Component:** code-generation (stub templates) + eslint config template.

### F5. Package resolution contradiction: exports → `dist/index.js`, builds emit declarations only

`main`/`types`/`exports` point at `./dist/index.js` while `build: tsc` runs
with `emitDeclarationOnly: true` — the file can never exist. TypeScript is
fooled by `tsconfig.base.json` paths (→ `src`), so the failure is latent until
the first _runtime_ resolution: Next bundling a workspace import, or a
cross-package Vitest test. Two coherent strategies exist; the scaffold
implements neither:

- **JIT/source (recommended for private monorepos):** exports →
  `./src/index.ts`, app gets `next.config.ts` with `transpilePackages`
  **plus** webpack `extensionAlias` (`".js": [".ts", ".tsx", ".js"]`) because
  generated barrels use NodeNext-style `.js` specifiers that webpack cannot
  resolve to `.ts` on its own (Vite/Vitest can). The generated apps/web had
  **no next.config at all**.
- **Compiled:** drop `emitDeclarationOnly`, emit real JS, accept watch-mode
  complexity.
  **Fix:** make it a manifest option (`monorepo.packageResolution: source |
compiled`) with `source` as default; emit the matching package.json fields,
  next.config, and app tsconfig together.
  **Component:** project-generation (workspace + app templates).

### F6. `apps/web/tsconfig.json` sets `rootDir: "."` with `noEmit: true`

Useless with noEmit, and it hard-errors (TS6059) the moment the app imports
workspace TS source — which the JIT strategy requires.
**Fix:** drop `rootDir` from the Next app tsconfig template.
**Component:** project-generation.

### F7. 9 of 17 packages missing the `src/index.ts` their exports point at

Non-deterministic: some contexts got a root barrel, most didn't. `tsc` passes
(it compiles files, not entry points) so the gap is invisible until import
time.
**Fix:** the barrel emitter must guarantee a root `index.ts` for every
workspace, and it should re-export **all** populated layers — see F13.
**Component:** sync (barrel emitter) / code-generation.

### F8. Workspace packages missing the devDependencies the manifest promises

`workspaceDefaults.packageJson.devDependencies` declares eslint +
typescript-eslint per package; the emitted package.jsons contain only
`typescript` and `vitest`. Consequence under yarn 4: `yarn workspace X lint`
fails with `command not found: eslint` (yarn exposes only declared deps'
binaries) — it only works through turbo's PATH injection, which masks the
defect.
**Fix:** actually emit the workspaceDefaults devDependencies; add a harness
step that runs one script via `yarn workspace` (not turbo).
**Component:** project-generation / sync (`packageJson.injectIfMissing`).

---

## P2 — Drift between manifest, invariants, and emitted config

### F9. Single-app template payload dumped at the root of a monorepo layout

~90 files (supabase, BullMQ + bull-board routes, five LLM adapters + router,
MCP server, auth, rate-limit middleware, docker compose set, design tokens,
env validation) landed at the repo root — outside `apps/*` and `packages/*`,
covered by no tsconfig/eslint/build, importing 15+ packages nobody declares.
This is the biggest credibility hit for a generated repo: dead, unchecked
code that looks like the project's own.
**Fix:** templates must be workspace-aware — install into a target workspace
(`apps/web` for UI/env templates, a chosen service for backend slices), add
their dependencies to that workspace's package.json, and refuse to install
into a root that isn't a workspace. If a template is incompatible with the
chosen workspace layout, fail loudly at generation time instead of emitting
orphans.
**Component:** template-engine.

### F10. Arch invariants don't encode what the manifest says

The manifest described `scene-types` as "type-only imports permitted in any
plane without restriction", but the emitted `linter-config.yaml` /
`layer-rules.yaml` whitelist only `@vellum/shared`. The very first real
cross-context import failed `lint:arch` with a double violation (boundary +
domain-layer). The manifest's prose and the enforcement config are generated
from the same source and still disagree.
**Fix:** support a manifest-level flag (e.g. `type: contracts-kernel` or
`allowed_in_all_layers: true` on a context) that manifest-generation compiles
into the invariant files. The linter's semantics were correct — the emission
was incomplete.
**Component:** manifest-generation + architectural-enforcement.

### F11. Sync's barrel ownership silently destroys hand-authored exports

Barrels carrying the `@generated by @hexagen/sync` header are regenerated
from the `*.adapter.ts` naming convention. Files that don't match (React
components, utility modules like `Bottle.ts`, `Exporters.ts`) are silently
dropped — a later `yarn sync` emptied three packages' public exports and the
app stopped compiling. The escape hatch (remove the header → treated as
hand-written) works but is undocumented and easy to trip, because the emitted
barrels _teach_ users the header convention.
**Fix (layered):** (a) document the hand-written escape hatch prominently in
generated barrel comments ("remove this header to take ownership"); (b) widen
the glob to all `.ts`/`.tsx` non-test files in the folder rather than
convention-named files only; (c) at minimum, `sync` should WARN when
regeneration would _remove_ existing exports, and `sync:check` should count
that as a destructive op requiring `--force`.
**Component:** sync.

### F12. Sync barrel generation is inconsistent on first contact

For one context it created `services/index.ts` and rewired `domain/index.ts`;
for three others with identical shapes it left `export {}`. Ordering/idempotency
bug — the same input shape should produce the same barrels.
**Component:** sync.

### F13. Generated root barrels export `application` only

`src/index.ts` = `export * from "./application/index.js"` — domain services
are unreachable from the package entry point even when the domain layer is
the only populated layer.
**Fix:** root barrel re-exports every layer barrel that exists (application,
domain, infrastructure), or at least all non-empty ones.
**Component:** sync / code-generation.

### F14. Manifest port listings seed meaningless stubs, then defend them

Contexts with no database got `RelationalDb.out-port.ts` / `DocumentDb.out-
port.ts`; deleting the dead stubs made `sync` recreate them until the manifest
`layers.application.ports.out` entries were hand-edited. The mechanism
(manifest is source of truth) is right; the _seeding_ is wrong.
**Fix:** stop seeding default port stubs unless the context description/config
asks for them; or derive them from `depends_on`-style intent. A generic
`ExternalServiceClient` in every context is noise that users must both delete
and un-manifest.
**Component:** manifest-generation + code-generation.

### F15. turbo.json drops manifest-declared config

Manifest: `turboConfig.globalDependencies: ['**/.env.*']` and (implicitly)
app build outputs. Emitted turbo.json: neither — so app builds warn "no output
files found" and are uncacheable, and env changes don't invalidate. Same
disease as F10: manifest says X, emission does Y.
**Fix:** emit `globalDependencies` verbatim; include `.next/**`,
`!.next/cache/**`, `.output/**`, `.nitro/**` in build outputs when the app
framework is Next/Nitro.
**Component:** project-generation.

### F16. Duplicate value-objects folders with different naming conventions

`packages/shared` contains BOTH `value-objects/` (hyphenated, real files) and
`value_objects/` (underscored, `.gitkeep`), while the manifest/layer config
uses `value_objects`. One convention, one folder.
**Component:** project-generation / sync.

---

## P3 — Docs and polish

### F17. SETUP.md describes the wrong project

Says "Framework: **nitro**" for a Next.js-fronted monorepo; walks through npm
commands in a repo whose `packageManager` pins yarn 4; references root-level
template paths. Should be assembled from the actual manifest: topology,
package manager, per-template setup only for installed templates.
**Component:** project-generation (docs templates).

### F18. AGENTS.md protects `package-lock.json` in a yarn-pinned repo

The never-edit table should name the lockfile of the chosen package manager.
**Component:** project-generation.

### F19. `eslint.no-console.mjs` emitted but wired to nothing

The no-console template drops the config file at the root and no eslint config
references it. Either wire it into the emitted flat configs or don't emit it.
**Component:** template-engine.

### F20. Day-one noise and small frictions

- Dependabot config produces 5 PRs (incl. two majors) within minutes of first
  push. Consider `open-pull-requests-limit` + ignoring majors in the shipped
  config for the first release cycle.
- `sync` on a dirty tree fails with "Fatal sync error: Dirty git tree" — fine,
  but the message should mention `--allow-dirty`.
- Failed `tsc` runs leave declaration artifacts at package roots (see F2);
  emitted `.gitignore` could also cover `packages/*/vitest.config.d.ts*` as a
  belt-and-suspenders.
- The deploy template emits `preview.yml`, `docker-build.yml`, and
  `deploy-vps.yml` that are **permanently red** until unrelated setup happens:
  they reference a `Dockerfile` (which the quarantined single-app payload
  supplied — deleted in a monorepo layout) and secrets (`VPS_HOST`,
  `VERCEL_TOKEN`, …) that are never configured. A fresh push shows 3–4 failing
  checks with no user error. Emit deploy workflows **disabled** (or gated on a
  `secrets != ''` guard / `workflow_dispatch` only) until the matching infra is
  actually scaffolded, so the default check set is all-green. Related to F21.

---

## What worked well (keep and protect)

- **Manifest bounded-context descriptions** carried real design decisions and
  survived contact with implementation almost untouched — this is the
  product's core value and it delivered.
- **arch-linter** caught genuine boundary violations (cross-context import,
  domain-layer purity) with actionable messages, and `depends_on` updates in
  the manifest were the natural remediation loop.
- **sync's non-destructive skips** of hand-written tsconfig/package.json
  worked exactly as designed, and `sync:check` converging to 0 ops made
  "manifest matches reality" a verifiable state.
- **Layer/subpath conventions** gave the implementation an unambiguous home
  for every file.

---

## Suggested milestones

| Milestone                                     | Contents                                         | Exit criterion                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 — Stop the bleeding                        | E2E generate-then-gate harness in CI; F1–F3, F21 | Fresh scaffold passes install/build/lint/test/arch/git-add on all fixtures **and** its own generated CI workflow goes green on a real push (actionlint + `act`/throwaway-repo run) |
| M2 — Coherent resolution & lint               | F4–F8                                            | Harness includes a cross-package import fixture (app + vitest) and a `yarn workspace X lint` step                                                                                  |
| M3 — Manifest is actually the source of truth | F10, F14, F15 (+F16)                             | Invariants, turbo.json, and port stubs are pure functions of the manifest; harness asserts round-trip                                                                              |
| M4 — Sync ownership semantics                 | F11–F13                                          | `sync` never deletes an export without `--force`; barrel generation deterministic; documented ownership model                                                                      |
| M5 — Workspace-aware templates                | F9, F19                                          | Templates install into workspaces with declared deps; orphan-file check in harness (`git ls-files` outside workspaces = fail)                                                      |
| M6 — Docs from manifest                       | F17, F18, F20                                    | SETUP/AGENTS assembled from manifest facts; no npm/yarn mismatch possible                                                                                                          |

Evidence trail for every finding: the Vellum repo's baseline commit
(scaffold as generated) vs. PRs #6–#10, plus
`docs/planning/2026-07-06-scaffold-remediation-plan.md` in that repo.
