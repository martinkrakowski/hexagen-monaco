# Generator Scaffold & Wizard Remediation Plan

Remediation for bugs and design gaps in the hexagen-monaco generator, surfaced
end-to-end while scaffolding and shipping a real generated project — **campaign-foundry**,
a Nitro + Next.js hexagonal modular monolith. Every item below was hit in the
_generated output_ and patched by hand there (the P0 items), removed outright
(#5, #6), or worked around in the wizard (#7). This plan ports proper fixes
**upstream into the templates/generators** so the next generated project is
correct by default instead of needing the same hand-repairs.

Locators are durable (file + symbol / search hint), not line numbers, per the
planning house style. None of these were caught by unit tests because they only
manifest in a _full generated project_ — so the real acceptance gate is the
generate→clone→build loop in [Cross-cutting](#cross-cutting).

## Summary

| Phase  | Item                                                                                      | Severity      | Source (template / generator · symbol)                                     | Blast radius                      |
| ------ | ----------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------- | --------------------------------- |
| **P0** | #1 `.gitignore` `out/` masks `ports/out/` source                                          | **Critical**  | `sync/…/root-file-templates.ts` · `BUILTIN_GITIGNORE_TEMPLATE`             | every bounded context's out-ports |
| **P0** | #2 base + app tsconfig `composite` & no `skipLibCheck` (TS6305)                           | High          | `…/root-file-templates.ts` · `BUILTIN_TSCONFIG_BASE_TEMPLATE` + apps       | all packages + apps typecheck     |
| **P0** | #3 Nitro app tsconfig silently drops `strict`                                             | High          | `sync/…/apps-framework-templates.ts` · `NITRO_TSCONFIG`                    | apps/api type safety (Result)     |
| **P0** | #4 generated apps get no `eslint.config.js`                                               | High          | `…/apps-framework-templates.ts` · `BUILTIN_FRAMEWORK_TEMPLATES`            | every app's lint / CI             |
| **P1** | #5 `preview.yml` no Corepack + premature `--immutable`                                    | Medium        | `template-engine/…/ci-github-actions` · `preview.yml`                      | preview CI on every PR            |
| **P1** | #6 `dependabot.yml` floods a freshly published repo                                       | Low           | `…/ci-github-actions` · `dependabot.yml`                                   | PR noise on publish               |
| **P1** | #7 wizard surfaces UI + API + persistence + messaging + telemetry **per bounded context** | High (design) | `project-wizard/…` · `ContextFormInfrastructure.tsx` + schema + deriveApps | project topology / app count      |
| **P2** | #8 `hexagen sync` rewrites ~50 unrelated files                                            | Low (DX)      | `sync/src/sync-engine.ts`                                                  | focused-PR friction               |

**P0 (#1–#4)** are independent template fixes that make a freshly generated
project **commit / typecheck / lint** correctly — the priority; each is a small,
isolated change with an emit-shape test. **#7** is the design change the wizard
needs (the issue that prompted this plan) and is its own larger track. **#5/#6**
are CI hygiene. **#8** is DX.

---

## #1 — `.gitignore` `out/` masks hexagonal `ports/out/` source · P0 (Critical)

**Root cause.** `BUILTIN_GITIGNORE_TEMPLATE` (`packages/sync/src/generators/root-file-templates.ts`)
lists a bare `out/` under "Build output". A gitignore pattern without a leading
slash matches a directory named `out` at **any depth**, so
`packages/<context>/src/application/ports/out/` — the driven-side outbound-ports
directory present in **every** bounded context of the generated hexagonal
architecture — is silently ignored. The generated source is never committed; a
fresh clone or CI checkout sees a project missing all its outbound port
interfaces, and the build/typecheck fails. (`out/` was intended to catch the
Next.js static-export directory.) In campaign-foundry this broke `main` until the
patterns were anchored and `ports/out/**` was recovered by hand.

**Fix.** Anchor every build-output pattern that could collide with source. Replace
bare `out/` with the actual export location (`apps/*/out/`, or drop it and let a
per-app `.gitignore` own it). Audit the template for any other short, unanchored
directory name that can shadow hexagonal source (`out` is the live offender;
guard prophylactically against `output`, `in`, `core`, etc.). Leave the genuinely
build-only, collision-free entries broad (`dist/`, `.turbo/`, `.next/`, `.nitro/`,
`.output/` — all safe; the dotted Nitro ones don't collide).

**Files.** `packages/sync/src/generators/root-file-templates.ts` · `BUILTIN_GITIGNORE_TEMPLATE`.

**Tests.** Regression test in the sync suite: generate a project, then assert
`git check-ignore` does **not** match a representative
`packages/<bc>/src/application/ports/out/<port>.ts`. Cheaper unit guard: the
emitted `.gitignore` contains no bare `out/` line (only anchored/app-scoped).

**Risk.** Low — only narrows ignore scope. Verify the Next.js static export
(`apps/web/out/`) is still ignored where it actually lives.

**Acceptance.** A freshly generated hexagonal project tracks every `ports/out/`
source file; `git status` shows them; `git check-ignore` returns nothing for them.

---

## #2 — Base + app tsconfig `composite` and missing `skipLibCheck` (TS6305) · P0

**Root cause.** Two coupled defaults break typecheck in the source-resolution
monorepo the generator produces (package `paths` → `packages/*/src/index.ts`,
Next `transpilePackages`, no per-package build; `typecheck` is `tsc --noEmit`):

- `BUILTIN_TSCONFIG_BASE_TEMPLATE` (`root-file-templates.ts`) sets `composite: true`
  - `emitDeclarationOnly: true`, and `NEXTJS_TSCONFIG` / `FASTIFY_TSCONFIG` /
    `PLAIN_TS_TSCONFIG` (`apps-framework-templates.ts`) re-assert `composite: true`.
    Composite implies project references with built outputs; with nothing actually
    built (source resolution), `tsc` raises **TS6305** ("output file has not been
    built from source file …").
- No `skipLibCheck` anywhere. A dependency that ships a forward-looking `.d.ts`
  (e.g. `@napi-rs/canvas` referencing `Float16Array`, a lib type newer than the
  configured `lib`) fails the typecheck of consumer code that never touches it.

**Fix.** (a) Add `"skipLibCheck": true` to the base `compilerOptions` —
uncontroversial for generated projects that consume third-party `.d.ts`. (b)
Reconcile `composite` with the build model: for the source-resolution default,
**drop `composite`/`emitDeclarationOnly`** from the base and the app tsconfigs and
rely on `noEmit` typecheck + `paths`; if project references are genuinely
intended, make `typecheck` build the refs first. Pick one model and make the
templates consistent.

**Files.** `root-file-templates.ts` · `BUILTIN_TSCONFIG_BASE_TEMPLATE`;
`apps-framework-templates.ts` · `NEXTJS_TSCONFIG`, `FASTIFY_TSCONFIG`,
`PLAIN_TS_TSCONFIG`.

**Tests.** Emit-shape assertions: base carries `skipLibCheck: true` and no
`composite` (under the chosen model). Integration: a generated project with a
dependency shipping forward-looking lib types passes `yarn typecheck`.

**Risk.** Medium — changing `composite` affects declaration emit if any real build
relies on references. Confirm the intended model (source-resolution vs
project-references) before flipping; keep them aligned across base + apps.

**Acceptance.** `yarn typecheck` is clean on a freshly generated project, including
with `@napi-rs/canvas`-style dependencies.

---

## #3 — Nitro app tsconfig silently drops `strict` · P0

**Root cause.** `NITRO_TSCONFIG` (`apps-framework-templates.ts`) extends
`./.nitro/types/tsconfig.json` and overrides only `moduleResolution: "bundler"`.
Extending Nitro's generated config is deliberate and correct (Nitro owns
resolution + auto-import types), but that config is **not `strict`**, so the API
app loses strict checking. `Result<T,E>` discriminated-union narrowing stops
working — the `success: true | false` branches no longer narrow `value`/`error` —
which is exactly what broke in campaign-foundry's `apps/api` (hand-fixed by
re-asserting strict).

**Fix.** Add `"strict": true` (and `"skipLibCheck": true`, see #2) to
`NITRO_TSCONFIG.compilerOptions` alongside `moduleResolution`. This keeps Nitro's
resolution/auto-imports while restoring strict narrowing. **Do not** switch the
`extends` back to the workspace base — that would drop the `.nitro/types`
auto-import declarations.

**Files.** `apps-framework-templates.ts` · `NITRO_TSCONFIG`.

**Tests.** Emit-shape: `NITRO_TSCONFIG.compilerOptions.strict === true`. Extend the
existing Phase-2 Nitro de-risk (nitro prepare → tsc → build green) with a
`Result`-narrowing fixture that only compiles under `strict`.

**Risk.** Low — additive. Re-run the nitro prepare→tsc→build green check.

**Acceptance.** A generated Nitro app narrows a discriminated-union `Result`
correctly under `tsc --noEmit`.

---

## #4 — Generated apps have no `eslint.config.js` · P0

**Root cause.** `BUILTIN_FRAMEWORK_TEMPLATES` (`apps-framework-templates.ts`) emits,
for **every** app framework (`next.js`, `fastify`, `plain-ts`, `nitro`), a `lint`
script (`eslint …`) plus the eslint devDeps — but **no `eslint.config.js`**. The
`BuiltinFrameworkTemplate` type only carries `packageJson` / `tsConfig` /
`entryPoint` / `extraFiles`. ESLint 9 requires a flat config; with none present,
`yarn lint` (turbo) aborts on the app's task with _"couldn't find an
eslint.config file"_ and CI fails. Bounded-context **packages** do get a config
(via `generateEslintConfig` in `eslint.ts`), so the gap is apps-only — it
surfaced as `@<scope>/api#lint` failing, but it affects every generated app.

**Fix.** Have the apps generator emit an `eslint.config.js` per app, reusing the
same flat config the package generator uses. Either add an `eslintConfig` field to
`BuiltinFrameworkTemplate` and write it next to `packageJson`/`tsConfig`, or share
`eslint.ts` · `BUILTIN_FALLBACK_TEMPLATE` as the single source. Prepend the
`// @generated by @hexagen/sync` marker and write via `safeWriteFileAtomic` so a
hand-authored app config stays protected. Align each app's `lint` glob with the
config's `files` (e.g. Nitro lints `server`, Next lints `src`).

**Files.** `apps-framework-templates.ts` · `BUILTIN_FRAMEWORK_TEMPLATES` (+ the app
emit step in the apps generator / `sync-engine.ts`); share the body with
`eslint.ts` · `BUILTIN_FALLBACK_TEMPLATE`.

**Tests.** Emit-shape / integration: every generated app has an `eslint.config.js`;
`yarn lint` exits 0 on a fresh generated project with a Nitro **and** a Next app.

**Risk.** Low — additive file. Respect the self-regen vs external gate (see
Cross-cutting) so it doesn't fight hexagen-monaco's own configs.

**Acceptance.** `yarn lint` passes on a freshly generated project; CI lint green.

---

## #5 — `preview.yml` fails before Corepack + premature `--immutable` · P1

**Root cause.** `preview.yml` (`ci-github-actions`) runs `actions/setup-node` with
`cache: "yarn"` then `yarn install --immutable`, with **no** `corepack enable` /
`corepack prepare` step. `setup-node`'s `cache: yarn` invokes Yarn (the runner's
global Classic 1.22) **before** Corepack activates the pinned `yarn@4.x`, producing
_"packageManager yarn@4.12.0 … current global version of Yarn is 1.22"_ at setup.
`--immutable` also requires a committed `yarn.lock`, which a first-push project
doesn't have. `ci.yml` in the same template does this correctly (`corepack enable`
→ `corepack prepare … --activate`, no setup-node yarn cache, plain `yarn install`);
`preview.yml` simply diverges. (It also deploys to Vercel using secrets a fresh
repo lacks.) In campaign-foundry the whole workflow was deleted as out-of-scope.

**Fix.** Bring `preview.yml` in line with `ci.yml`: add the `corepack enable` +
`corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate`
steps before install, drop `cache: "yarn"` (or move it after Corepack), and use
plain `yarn install` (switch to `--immutable` only post-lockfile, mirroring
`SETUP.md`). Optionally gate the job on "preview requested **and** Vercel secrets
present" so it no-ops cleanly when unconfigured rather than failing red.

**Files.** `packages/template-engine/templates/ci-github-actions/files/.github/workflows/preview.yml`
(reference: `ci.yml` in the same directory).

**Tests.** Extend `template-engine/__tests__/templates/ci-github-actions-emit-shape.test.ts`:
assert `preview.yml` contains a Corepack step and no pre-Corepack `cache: yarn`.

**Risk.** Low.

**Acceptance.** The preview workflow installs deps on a `yarn@4` project with no
Corepack mismatch.

---

## #6 — `dependabot.yml` floods a freshly published repo · P1 (Low)

**Root cause.** `dependabot.yml` (`ci-github-actions`) configures `github-actions`
(limit 5) + `npm` (limit 5) but groups **only** dev-dependencies; production deps
are ungrouped, so each prod-dep bump opens its own PR. On first publish every dep
is "behind latest" at once → a wave of ~9 PRs (4 actions + 1 grouped dev + N prod),
several of them breaking-risk majors. Observed live on campaign-foundry's first
push (the config was removed there to stop the noise).

**Fix.** Tame the defaults: add a `production-dependencies` group (or group by
`minor`/`patch`, letting majors through individually), lower
`open-pull-requests-limit`, and/or default the npm ecosystem to **security-only**
updates for a fresh scaffold (version updates opt-in). Document the trade-off in
the template `README.md`.

**Files.** `…/ci-github-actions/files/.github/dependabot.yml` (+ template `README.md`).

**Tests.** Optional emit-shape assertion on grouping/limits.

**Risk.** Low (config-only).

**Acceptance.** A freshly published project opens a small, grouped set of dependency
PRs instead of a wave.

---

## #7 — Wizard surfaces UI + API + persistence + messaging + telemetry **per bounded context** · P1 (Design)

> This is the issue that prompted the plan: "each bounded context within the
> project-wizard surfaces both options for UI and APIs … I only want a single
> Next.js application."

**Root cause.** `ContextFormInfrastructure.tsx`
(`apps/web/features/project-wizard/steps/bounded-context-step/`) renders, **for each
bounded context**, five infrastructure selects — **API Backend**
(`infrastructureTarget`), **UI Frontend** (`uiFramework`), **Persistence**
(`persistenceAdapter`), **Messaging** (`messagingAdapter`), **Telemetry**
(`telemetryProvider`) — backed by per-context fields on `ProjectConfig`
(`@hexagen/project-configuration`). The model treats **presentation (UI) and API
hosting as per-domain-module concerns**. But a bounded context is a _domain
boundary_, not a deployable app. Consequences:

- Every context can independently request its own UI **and** API backend.
- The `infrastructureTarget → deriveApps` seam (see `apps-framework-templates.ts` /
  project-generation `deriveApps`) can materialize **multiple or conflicting apps**
  — one per context — when the user wants one.
- A user who wants "one Next.js app in `apps/web`" must set UI/API on _each_
  context and hope they de-dupe; the obvious reading is "N UIs". That's the
  reported confusion.

**Fix (design — stage it).** Separate the **application / presentation layer** from
**bounded-context domain config**:

1. **Move UI (`uiFramework`) and API host (`infrastructureTarget`) to a
   project-level "Applications" config** — one or more apps, each app selecting
   _which bounded contexts it exposes_ — instead of per-context fields. Default to a
   **single-application preset** (one Next.js `apps/web` + one API) so the common
   case is one choice.
2. Keep per-context only the **domain-owned driven infra** (persistence, messaging —
   the outbound adapters a context legitimately owns); these already have a natural
   home in the **port-configuration step** alongside `outboundPorts`.
3. **Update `deriveApps`** to consume the project-level app list (one app per
   framework/target by default) rather than emitting an app per context.
4. Make per-context UI/API an explicit **advanced opt-in** for the genuine
   micro-frontend / multi-service case.

**Files.** `apps/web/features/project-wizard/steps/bounded-context-step/ContextFormInfrastructure.tsx`;
`apps/web/features/project-wizard/config.ts` (the `*Options` lists);
`@hexagen/project-configuration` schema (per-context `uiFramework` /
`infrastructureTarget` / `persistenceAdapter` / … fields); the
`infrastructureTarget → deriveApps` seam (`apps-framework-templates.ts` +
project-generation); `@hexagen/wizard-orchestration` `wizard-to-manifest.ts`
mapping.

**Tests.** Wizard form: UI/API are not per-context by default. `deriveApps`:
per-context infra no longer yields N apps; the single-app preset yields exactly one
`apps/web` + one API. Manifest mapping round-trips the new shape.

**Risk.** High — touches wizard UX, the `ProjectConfig` schema (needs a migration /
back-compat read), manifest mapping, and app derivation. Sequence it: **(a)** schema

- `deriveApps` (back-compat: collapse per-context infra to a single app), **(b)** the
  wizard UX. Record the project-model change as an **ADR** in `.architecture/decisions/`.

**Acceptance.** A user scaffolds a single Next.js app spanning all bounded contexts
without per-context UI/API toggles; per-context infra no longer over-generates apps.

---

## #8 — `hexagen sync` rewrites ~50 unrelated files · P2 (DX)

**Root cause.** `hexagen sync` (`packages/sync/src/sync-engine.ts`) regenerates all
`@generated` barrels/configs across the workspace, so any sync run touches ~50
unrelated files — hostile to focused PRs (in practice you hand-edit the one barrel
instead of running sync). Documented DX friction during campaign-foundry's focused
PRs.

**Fix.** Scope sync output: a `--only <path|glob>` / `--changed` flag, split
generated-barrel regen from the rest, and/or make sync **idempotent-by-hash** so
unchanged files aren't rewritten (no timestamp/formatting churn). Improve the change
report so a targeted regen is discoverable.

**Files.** `packages/sync/src/sync-engine.ts`, `packages/sync/src/cli.ts`.

**Tests.** A no-op `hexagen sync` on an unchanged workspace writes **zero** files;
`--only` limits scope to the named package.

**Risk.** Medium — touches core sync orchestration.

**Acceptance.** A no-op sync writes nothing; a targeted sync touches only the
intended package.

---

## Cross-cutting

- **The real acceptance gate is the generate→clone→build loop.** Every one of these
  escaped unit tests because they only manifest in a full generated project. For each
  P0 item, validate by **generating a fresh project** from a representative manifest
  (Nitro + Next + ≥2 bounded contexts), then in the _generated output_: `git init`,
  `yarn install`, `yarn build && yarn typecheck && yarn lint && yarn test`, and
  `git status` / `git check-ignore` to confirm no source is masked. Add this as a
  generator end-to-end smoke test if one doesn't exist.
- **Self-regen vs external gate (recurring trap).** Every sync emitter must be
  correct in **both** modes — _self-regen_ (hexagen-monaco's own hand-maintained
  files) and _external_ (generated projects). The #1/#2/#3/#4 template changes must
  not break hexagen-monaco's own `hexagen sync`. Re-run a self-sync and diff.
- **Emit-shape tests.** Add/extend the `template-engine` and `sync` `__tests__`
  emit-shape assertions for each template change so these don't regress silently.
- **Sequencing.** P0 (#1–#4) first and independently — they unblock "the generated
  project builds and commits"; each is a one-template PR. Then P1 CI (#5, #6). **#7**
  is its own track (schema + `deriveApps`, then wizard UX, behind an ADR). #8 is DX,
  anytime.
- **Provenance.** All items were found while building **campaign-foundry** (a Nitro +
  Next.js hexagonal monolith). #1–#4 were patched by hand in that repo; #5/#6 were
  removed there to unblock; #7 was worked around manually in the wizard. This plan
  moves the fixes to the source so they're inherited, not re-applied per project.
