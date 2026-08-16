# Sync Toolchain Remediation — Development Plan

> **⚠️ Historical record — the test-runner mandate below is superseded.** This plan
> repeatedly mandates `node:test` + `tsx --test` and says "never vitest/jest/`expect()`".
> That was the house rule on 2026-06-11; **ADR-0044 made Vitest the monorepo runner**, and
> the migration is complete. The `node:test` mandate in §Overview, the exit-code contract
> suite, and §House-rule gates is **no longer in force** — read those as the runner that
> was current when the plan was written, not as guidance to follow. The rest of the plan
> (dead-generator finding, mkdir accounting, version inlining, governance gates) stands.
> Assertions are unaffected: `node:assert/strict` is still fine, per AGENTS.md.

**Status:** Proposed — ready to execute. Not started.
**Date:** 2026-06-11 · **Amended same day** after a four-review pass — test-runner mandate (`node:test`, never vitest), dead-generator finding reshaping B2, `layer-folders` mkdir accounting + dry-run gap, build-time version inlining for A3, consumer-resolved-commander candidate for A1, and the AGENTS.md governance gates (manifest mapping, protected files, frozen contexts).
**Source:** [sync-toolchain-rca-and-remediation.md](./sync-toolchain-rca-and-remediation.md) (the RCA; findings #1–#9 referenced throughout as "RCA #n").
**Sibling:** [generator-scaffold-and-wizard-remediation.md](./generator-scaffold-and-wizard-remediation.md) — this plan supersedes its #8 (via PR-B2) and coordinates template-content changes with it (PR-C4).

Locators are durable (file + symbol / search hint), not line numbers, per the planning house style.

## Re-verification against HEAD (2026-06-11)

The RCA was verified against the **published** artifacts (0.4.2 / 0.6.0). Before slicing PRs, every finding was re-checked against current `main`. Deltas that shape this plan:

1. **Main has not diverged from v0.6.0 for the tooling.** `git log v0.6.0..main -- packages/sync tools/arch-linter` is only the ADR-0042 + 0.7.0 version-bump squash (`77854099`, #312) plus an unrelated wizard PR (#276). Every RCA finding is live on HEAD; nothing has been fixed in the interim.
2. **The cross-cutting harness already exists.** `scripts/capstone/first-run-green.js` + `.github/workflows/capstone.yml` ("First-Run-Green") already do build → `prepare-publish-package.js` stage → `npm pack` → generate scaffold → `yarn install` → run the **installed** bins. The RCA's contract gate is an _extension of capstone_, not a new harness. **But:** capstone forces the tooling to packed tarballs via `resolutions:` — which _masks RCA #1_ (any pin range "installs fine" when overridden). PR-A3 must add an explicit pin-compatibility assertion or the harness can't catch a pin regression.
3. **`safeWriteFileAtomic` already content-hash-compares** (`packages/sync/src/fs-utils.ts` — returns `"unchanged"` before the dry-run branch, which itself was already fixed to report protected/hand-written files as skips) — and routing through it is already near-universal among the **live** generators (`apps.ts`, `cross-context.ts`, `shared-kernel.ts`, barrels, eslint, tsconfig, package-json, stubs). So RCA #5 is narrower still: the converged-tree noise is **accounting**, not bypassed writes. Primary source: `generators/layer-folders.ts` pushes every layer/subfolder `fs.mkdir` into `result.created` on _every_ run — `mkdir` with `recursive: true` never throws `EEXIST`, so its catch→`skipped` branches are dead and the count scales with contexts × layers × subfolders (the RCA's constant "67–70 created"). Secondary: the unlink-counted-as-`created` branch and the report side-write. The generators with genuinely raw writes (`wiring.ts`, `test-generator.ts`, `migration-assistant.ts`) are **dead code** — not imported by the engine, not exported by the barrel, zero callers repo-wide — so the call there is delete-or-wire, not reroute (D6). The one live deliberate raw write (`architecture-files.ts` · external-mode bootstrap manifest) is exists-checked and dry-run gated — a documented exception. PR-B2 is an accounting fix plus a dead-code decision, not a new mechanism.
4. **Confirmed unguarded mutation sites for RCA #3:** `generators/barrels/recursive.ts` (empty-content `fs.unlink`, not gated by `dryRun`, pushed into `result.created`), `migration-report.ts` (unconditional `createWriteStream`), and `generators/layer-folders.ts` (ungated `fs.mkdir` per layer/subfolder — a dry-run on a non-converged tree materializes empty directory trees, which `git status --porcelain` **cannot see**: git doesn't track empty dirs). `generators/reap.ts` _is_ dry-run gated — the audit in PR-A2 is a sweep, not a rewrite.
5. **The `arch validate` exit-0 swallow is not visible in source.** `commands/arch/validate.ts` exits 1 on both failure paths; `manifest-service.ts · validateManifest` maps a failing `hexagen-lint` exec to `valid: false`; the linter's own startup exits 1 on a bad manifest. Yet the published binaries exit 0 (RCA evidence). The swallow therefore lives in the **built/published artifact** (tsup bundle, bin shim, or commander's sync `program.parse` + async-action wiring). PR-A1 starts with a reproduce-on-built-dist step — fixing source patterns without pinning the artifact-level mechanism risks "fixed in source, still broken on npm".
6. **Version state changes the release vehicle.** Main's package versions are already bumped to **0.7.0, unpublished** (tag not pushed; npm `latest` = 0.6.0). The RCA's "ship P0 as 0.6.1" is overtaken: the cheapest correct path is to **hold the v0.7.0 tag until the P0 wave merges** and publish once (see Release sequencing).
7. **Schema drift continues as a matter of course** (`packages/project-configuration` has follow-on work queued: normalizer rewire, free-tier). `ManifestSchema` is `.strict()` — every future additive key is a repeat of this incident for any consumer whose CLI lags. #1 and #6 are the durable guards, not one-off repairs.

## PR map

| PR     | RCA | Title                                                             | Wave         | Depends on                |
| ------ | --- | ----------------------------------------------------------------- | ------------ | ------------------------- |
| **A1** | #2  | Honest exit codes across both CLIs + built-dist contract tests    | P0 → v0.7.0  | —                         |
| **A2** | #3  | `--dry-run` never mutates the consumer tree                       | P0 → v0.7.0  | A1 (tests)                |
| **A3** | #1  | Scaffold pins derived from the engine version + capstone pin gate | P0 → v0.7.0  | A1 (tests)                |
| **B1** | #4  | Scoped, journaled rollback; never rollback under `--allow-dirty`  | P1 → 0.7.x   | A1, A2 (sweep table)      |
| **B2** | #5  | Truthful change reporting + `--check` drift gate                  | P1 → 0.7.x   | A2                        |
| **C1** | #6  | Manifest `schemaVersion` + `hexagen manifest migrate`             | P2           | A3                        |
| **C2** | #7  | Root-resolution error names the npx/global footgun                | P2 (trivial) | —                         |
| **C3** | #8  | Linter honors manifest `depends_on` (decision: option a)          | P2           | —                         |
| **C4** | #9  | Scaffolded governance content tells the truth                     | P2           | sibling plan coordination |

Wave A is the release train: all three are small, independent in code, and ship together as the next published version. A1 lands first because **its contract-test harness is what makes A2/A3 acceptance enforceable** (you cannot CI-gate dry-run purity while failures exit 0 — the RCA's double-masking lesson). B and C waves ride later 0.7.x releases; C2 can be folded into any adjacent PR.

---

## Wave A — P0, the release train

### PR-A1 — Honest exit codes across both CLIs (RCA #2)

**Goal.** Every failure mode of `hexagen` (all subcommands) and `hexagen-lint` exits ≠ 0 — _as published artifacts_, not just as TS source.

**Step 1 — reproduce on the built artifact (in-PR investigation).** Reuse capstone's stage+pack steps (`scripts/prepare-publish-package.js` → `npm pack`) to install the tarballs into a broken-manifest fixture; confirm the three observed exit-0s (`sync --dry-run` manifest failure, `arch validate` manifest failure, `arch validate` real violations) and pin the swallow. Candidates: (a) commander **sync** `program.parse(process.argv)` driving async actions (`cli.ts · buildProgram` tail) — though on Node ≥ 15 an _unhandled_ rejection terminates with exit 1, so this alone cannot explain exit 0; (b) **consumer-resolved commander**: ADR-0009 keeps commander/js-yaml _external_ to the tsup bundle, so the installed CLI runs whatever commander the consumer's `node_modules` resolves — behavior drift invisible to repo-local testing, and the reason the capstone layer must run these probes too; (c) tsup bundle/banner/shim divergence — noting the two bins differ structurally: `hexagen` is commander-driven, while `hexagen-lint`'s entry is a _top-level script_ whose `process.exit(1)` sites live in module-evaluation code, so its swallow mechanism is necessarily different; (d) bin-shim behavior. Record the mechanism in the PR description — it decides whether the parse-wiring fix alone suffices or the bundle config also needs a change.

**Step 2 — fix.**

- `cli.ts`: switch to `await program.parseAsync(process.argv)` inside an async `main()`; on rejection set `process.exitCode = 1` (prefer `exitCode` over `process.exit()` so stdout/stderr flush). Audit **every** `.action(async …)` for the same pattern (`arch list/validate/port/context/remove/diff/edit/refactor`, `manifest split`, `templates`, `add`, `validate-templates`).
- `sync-engine.ts · run()` catch: **rethrow on dry-run failure** instead of swallowing (the confirmed `[sync] Sync failed … exit 0` path). Move exit-code decisions out of the engine to the CLI layer (`run()` throws or returns a failure result; `cli.ts` sets the code) — also a prerequisite for B1's rollback rework.
- `tools/arch-linter/src/index.ts`: audit the tail (violation path already calls `process.exit(1)`; verify it survives the build).

**Tests.**

- New **exit-code contract suite** in `packages/sync/__tests__/` — `node:test` + `node:assert/strict` via the package's `tsx --test` runner (house mandate; never vitest/jest/`expect()`) — spawning the **built `dist/cli.js`** (and the built `hexagen-lint`) via `execFile` against fixture dirs: success → 0; broken manifest (an extra unrecognized key) → ≠0 for `sync --dry-run` _and_ `arch validate`; real boundary violation → ≠0. Wire `test` to depend on `build` so the suite always sees fresh dist — **this edits `turbo.json`, a protected file** (AGENTS.md Files-Never-Edit): state the reason, get confirmation, follow the `--force-root` protocol, call it out in the PR.
- Capstone phase: after the existing real-sync step, copy in a broken manifest → both installed bins exit ≠0. This covers the npm-pack / bin-shim / consumer-resolved-commander layer the repo-local suite can't.

**Risk.** Low–medium. `parseAsync` changes error propagation for _all_ subcommands — the audit must catch actions that relied on rejections escaping. Behavior change is strictly "failures now fail", but any consumer script that accidentally depended on exit-0 will start failing (that is the point; release-note it).

**Acceptance.** RCA #2 acceptance verbatim, executed against built artifacts in CI.

### PR-A2 — `--dry-run` never mutates the consumer tree (RCA #3)

**Goal.** `sync --dry-run` is a pure preview: zero writes, zero deletes, zero report files.

**Changes.**

- `generators/barrels/recursive.ts` · empty-content branch: under `dryRun`, log "would delete" and record the path in a new `result.deleted` bucket (introduced here, completed in B2) — no `fs.unlink`. Real runs keep the unlink but move the path from `created` to `deleted`.
- `generators/layer-folders.ts`: gate the layer/subfolder `fs.mkdir` calls under `dryRun` (currently ungated — a dry-run materializes empty directory trees). The _counting_ fix (created-on-every-run) is B2's; the _mutation_ fix is here.
- `migration-report.ts`: never `createWriteStream` under dry-run — print the summary to stdout; add `--report <path>` as an opt-in flag (real runs keep writing `SYNC-MIGRATION-REPORT.md` by default for now; flip to opt-in only if Martin prefers — see Decision log D5). While here: `writeReport` ends the stream without awaiting `finish` — await it so a prompt exit can't truncate a real-run report.
- **Mutation-site sweep**: audit every `fs.unlink` / `fs.rm` / `fs.rename` / `fs.mkdir` / raw `fs.writeFile` / `createWriteStream` under `packages/sync/src/` (engine + generators) for a missing `dryRun` gate. Known-good: `reap.ts`, `safeWriteFileAtomic`. Known-bad: the three sites above. Everything else: verify and table the result in the PR — the table doubles as B1's journal-coverage checklist.

**Tests.** `node:test` fixture (tmp dir, `git init`, seeded legacy empty `export {}` barrels — the exact campaign-foundry shape; fixture content only, never committed source barrels, per the house barrel rule): run dry-run via the built CLI → `git status --porcelain` is empty **and** a directory snapshot (`find -type d` before/after) is unchanged — porcelain alone cannot see the empty dirs the ungated mkdirs would create. Capstone phase: `git init` the generated scaffold before the dry-run step, assert porcelain-empty + dir-snapshot-equal afterwards.

**Risk.** Low. Purely subtractive under `dryRun`.

**Acceptance.** RCA #3 acceptance verbatim; capstone enforces it on every PR touching sync.

### PR-A3 — Scaffold pins derived from the engine version (RCA #1)

**Goal.** The wizard/scaffold and the CLI pins it emits are the same code generation by construction.

**Changes.**

- `generators/root-file-templates.ts` · `BUILTIN_PACKAGE_JSON_TEMPLATE`: replace the literal `"^0.4.0"`s with `"^{toolchainVersion}"` placeholders.
- `generators/root-files.ts`: interpolate from the engine's own version at generation time. **Do not reuse `cli.ts · readVersion` as-is** — it resolves `../package.json` from `import.meta.url` and silently falls back to `"0.0.0"`. That layout holds in the published dist, but the wizard executes `generateRootFiles` inside the Next.js **server bundle** (web export routes → `project-generation`'s external sync engine), where the path breaks and the deployed wizard would silently emit `^0.0.0` pins. Instead: **inline the version at build time** (static `package.json` import / build-injected constant — tsup and Next both resolve it statically) and **hard-fail generation if it's missing or `0.0.0`** — never emit a degenerate pin. Scope note: the value comes from workspace `@hexagen/sync`'s `package.json` but is emitted under the public `@hexagen-monaco/*` names — same number by the co-release invariant `publish.yml` enforces; publish staging rewrites only the scope.
- **Self-regen guard** (recurring trap): `BUILTIN_PACKAGE_JSON_TEMPLATE` is external-mode-only today — assert that (mode check or emit-shape test) so a future self-regen run can't rewrite hexagen-monaco's own root `package.json` with interpolated pins. Re-run a self-sync and diff before merging.
- Caret semantics are now _self-consistent_: `^0.7.0` freezes the minor, and the engine that wrote the manifest is the same minor — skew within a consumer can only re-open if the consumer hand-upgrades one side, which is #6's territory.
- **Capstone pin gate** (closes the masking gap from Re-verification §2): before applying `resolutions:`, assert the scaffold's emitted `devDependencies` ranges are satisfied by the packed tarball versions (`semver.satisfies(packedVersion, emittedRange)`). The resolutions stay (the registry doesn't have unpublished versions — hermeticity requires them), but the contract is now asserted instead of bypassed. Scope honesty: the gate proves _self-consistency_ (emitted range ↔ packed artifact); it cannot prove what npm actually serves — registry availability stays a runbook invariant (below), and cross-version skew guidance is C1's job.

**Known trade-off — npm lag.** A wizard deployed from main emits `^<mainVersion>`; if that version isn't on npm yet, the consumer's _install_ fails loudly on day one. That is strictly better than the silent schema skew it replaces, but it creates a process invariant: **publish the npm release before (or with) any prod wizard deploy that bumps the toolchain version.** Recorded in Release sequencing; the registry-clamp alternative (query npm at scaffold time) is rejected as a network dependency in the generation path (Decision log D4).

**Tests.** Emit-shape: generated root `package.json` pins both `@hexagen-monaco/*` packages at the engine's own version; no literal `0.4.0` anywhere in `generators/`. Capstone: the satisfies-assertion above + the existing install/run steps now execute _with verified-compatible pins_.

**Risk.** Low. One template + one interpolation; the failure mode moves from silent to loud.

**Acceptance.** RCA #1 acceptance: capstone installs with the scaffolded pins (assertion-verified) and both installed CLIs load the manifest the same generation wrote.

### Wave-A release (the v0.7.0 train)

1. Merge A1 → A2 → A3 (or A2/A3 in parallel once A1's harness is in).
2. Push the `v0.7.0` tag → `publish.yml` co-releases both packages. **Tag push stays Martin-gated** (repo rule: release tags trigger live npm publish — explicit go-ahead only).
3. Consumer follow-up (campaign-foundry, branch `fix/hexagen-tooling`): bump pins to `^0.7.0`, wire `yarn sync:dry` + `yarn lint:arch` into CI — _now meaningful because failures exit ≠ 0_. The `--check` drift gate follows after B2.
4. Ordering invariant: if the prod wizard deploy (pending on the LLM-overhaul wave) goes out first, it scaffolds `^0.7.0` consumers against an npm that only has 0.6.0 → loud install failures. **Publish v0.7.0 before or with that deploy.**

---

## Wave B — P1 hardening (0.7.x)

### PR-B1 — Scoped, journaled rollback (RCA #4)

**Goal.** A failed sync restores exactly what sync touched — never `git reset --hard && git clean -fd` against the consumer's tree; never _any_ rollback under `--allow-dirty`.

**Design.** Journaled inverse-ops, not git-wide resets: `safeWriteFileAtomic` already reads the pre-image of every file it overwrites — extend the engine to record a journal entry per mutation (`{path, preContent | null}`; `null` = created, content = overwritten/deleted; deletes from PR-A2's `deleted` path journal their pre-image too). On failure, replay the journal in reverse: restore pre-images, unlink created files. Untracked files sync never touched are _never_ visible to this mechanism — the data-loss class is gone structurally, not by policy. Under `--allow-dirty`: skip rollback entirely, print the journal ("sync failed after touching these N paths") and exit ≠0 (honest codes from A1). Keep the clean-tree preflight as the default belt.

**Failure-during-rollback semantics:** journal replay is per-entry best-effort; if an inverse op fails, print the remaining journal (path + intended action), exit ≠0, and **never** fall back to a git-wide reset/clean. **Seam decision (in-PR):** deliberate out-of-band mutations — the external-mode bootstrap manifest write in `architecture-files.ts`, directory creation — either participate in the journal or are table-documented exceptions; decide explicitly. **Governance:** `journal.ts` is a new structural element — map it in `.architecture/manifest.yaml` and run `yarn lint:arch` _before_ implementation (house rule).

**Files.** `sync-engine.ts` · `run()` catch + a small `journal.ts`; `fs-utils.ts` (journal hook).

**Tests.** Fixture: dirty tracked file + untracked scratch file + a generator forced to fail mid-run (e.g. inject a `CircularExportError` after the first writes); under `--allow-dirty` both files survive byte-identical and the failure exits ≠0. Second test: same failure without `--allow-dirty` on a clean tree → tree restored to pre-sync state (porcelain empty).

**Risk.** Medium — touches the engine's failure path. The journal must cover _every_ mutation site (PR-A2's sweep table is the checklist; this is why B1 follows A2).

**Acceptance.** RCA #4 acceptance verbatim.

### PR-B2 — Truthful change reporting + `--check` (RCA #5; supersedes sibling plan #8)

**Goal.** Counts mean what they say; a converged tree reports zero; `sync --check` is the consumer's CI drift gate.

**Changes.**

- Fix the **accounting** (the primary mechanism — Re-verification §3): `layer-folders.ts` probes existence before each `mkdir` and counts `created` only when the directory was actually absent; the dead `EEXIST` catch branches go (recursive `mkdir` never throws it). Then audit every `result.created.push` / `result.updated.push` site; `unchanged` is never counted as a change; deletions go to `result.deleted` (from A2). The engine summary prints `created / updated / deleted / unchanged / skipped`. (Second real sync is byte-idempotent per the RCA evidence, so content is deterministic — the counts were lying, not the writes.)
- **Dead-generator decision (D6):** `wiring.ts`, `test-generator.ts`, `migration-assistant.ts` have zero callers — delete them (recoverable from git) rather than wiring unreachable code through the writer; if one is actually wanted, wiring it live is its own PR with its own tests. The one deliberate raw write (`architecture-files.ts` · external bootstrap manifest — exists-checked, dry-run gated) stays as a documented exception; live generators already route through `safeWriteFileAtomic`.
- New `hexagen sync --check`: implies `--dry-run`; exits ≠0 iff any change is planned. Scaffold's root `package.json` template gains `"sync:check": "hexagen sync --check"`.

**Tests.** `node:test` converged fixture (real sync, then): dry-run prints zero planned changes, exits 0; delete one generated barrel → exactly one planned change; `--check` exits ≠0. Capstone phases: scaffold after first real sync → `sync --check` exits 0; **second real sync is byte-level idempotent** (`git status --porcelain` empty) — RCA gate steps 2–3.

**Risk.** Medium — touches most generators, but mechanically (writer routing + counters). The self-regen vs external trap applies: re-run a self-sync on hexagen-monaco and diff before merging (recurring-trap rule from the sibling plan).

**Acceptance.** RCA #5 acceptance verbatim. Close sibling plan #8 with a pointer here.

---

## Wave C — P2 (independent; any order after Wave A)

### PR-C1 — Manifest `schemaVersion` + `hexagen manifest migrate` (RCA #6)

**Changes.**

- `project-configuration` · `manifest-schema.ts`: add `schemaVersion` (optional; absent = legacy) + export `CURRENT_MANIFEST_SCHEMA_VERSION`.
- **Check order matters because the schema is `.strict()`:** the CLI must read `schemaVersion` from the _raw_ YAML (plain `js-yaml` load) **before** the strict zod parse and fail with the guided message ("this manifest requires @hexagen-monaco/sync ≥ X — run `hexagen manifest migrate`") on mismatch — otherwise a future unknown key still surfaces as raw `unrecognized_keys` before the version check runs. Wire it inside **`project-configuration`'s `manifest-merge-loader` (the `/server` export)** — `packages/sync/src/loaders/` only _re-exports_ it, and the linter inlines the same module via the ADR-0009 bundle — one seam, inherited by all five `hexagen` commands _and_ `hexagen-lint`.
- `commands/manifest/`: add `migrate` beside `split` — stamps the current `schemaVersion`, applies registered key migrations (registry starts empty; the pattern is the deliverable).
- Wizard: `wizard-orchestration` · `wizard-to-manifest.ts` stamps `schemaVersion` at scaffold time.
- **Skew note:** older published CLIs strict-reject manifests _carrying_ the new key — acceptable because only newly scaffolded projects (whose pins are ≥ the writer, per A3) and explicitly `migrate`d manifests carry it. Release-note it regardless.
- **Governance:** the `migrate` command file and the schema element are new structural elements — map them in `.architecture/manifest.yaml` + run `yarn lint:arch` before implementation files (house rule).

**Tests.** Fixture manifests: legacy (no key) parses; future version → guided error (not zod output) from both `sync` and the linter path; `migrate` stamps and is idempotent.

### PR-C2 — Root-resolution error names the footgun (RCA #7)

`sync-engine-init.ts` · the workspace-walk throw: include the walk's start directory and the hint "if you ran this via npx or a global install, install @hexagen-monaco/sync as a devDependency of your project instead." Mirror the arch-linter's resolver affordances (`--root` / `HEXAGEN_ROOT`) in the message if applicable. Optionally prefer `process.cwd()` as the walk origin in `external` mode — decide in-PR; the message fix alone closes the RCA item. Trivial; may ride along with any B/C PR.

### PR-C3 — Linter honors manifest `depends_on` (RCA #8, option (a))

**Decision (flagged, recommendation: (a)).** The manifest becomes the per-context source of truth for cross-context import legality; invariants remain _additional_ constraints. (b) — docs-honesty only — stays the documented fallback if (a) reveals consumer breakage.

**Changes.** `tools/arch-linter` (`index.ts` import-legality + `subpath-violation.ts`): allowed cross-context imports for context X = `global_whitelist` ∪ shared-kernel ∪ X's manifest `depends_on`. Precedent exists: the linter already reads manifest relationships for `required_communication` (#241), so this completes the same movement. Fix the success message either way — "compliant with manifest.yaml" must name what was actually checked. Scaffold side: the wizard already records `depends_on`; verify `architecture-file-templates.ts` doesn't emit a `global_whitelist` that makes every `depends_on` vacuous. Record the choice as an ADR in `.architecture/decisions/` (it redefines the spec/enforcement contract). **Governance:** the linter belongs to the `architectural-enforcement` context, which carries `status: frozen` in the manifest — clear that gate (plus manifest mapping + `yarn lint:arch`) before implementation.

**Tests.** Fixtures: import covered by `depends_on` passes without whitelist; same import minus the edge fails; whitelist still grants extra-manifest allowances.

### PR-C4 — Scaffolded governance content tells the truth (RCA #9)

**Changes.**

- `architecture-files.ts` · `buildOwnershipBlock`: duplicate port/adapter names across contexts currently emit duplicate YAML keys (first silently dropped — contradicting the emitted `port-single-ownership` invariant). Fix: detect collisions; emit context-qualified keys (or warn-and-list), never duplicate keys.
- Template content (source of truth is `packages/template-engine/templates/**` — the `template-bundle.generated.ts` is `@generated`; regenerate, don't hand-edit): AGENTS.md governance sections (structured-logger mandate, `eslint-no-console`) become conditional on the templates that actually install them; `.gitignore.hexagen` text must match `validate-templates` reality.
- Unify the `workspaceTemplate` (manifest) vs `workspace_template` (generator config) spelling — pick one, map explicitly at the read site, emit consistently.
- **Coordinate with the sibling plan** (it owns these template files; its #2 / PR #267 is open against root templates) — sequence to avoid conflicts.

**Tests.** Emit-shape: generated `generator.config.yaml` round-trips through a strict YAML parser with duplicate-key detection; AGENTS.md sections appear only with their templates.

---

## Cross-cutting acceptance gate (capstone end-state)

Capstone grows one phase per PR; final contract = the RCA's gate, mapped:

| #   | Capstone phase                                                                                                           | Lands with |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | Install with **scaffolded pins** (satisfies-assertion; resolutions for hermeticity)                                      | A3         |
| 2   | **Converged** scaffold (post-first-sync) dry-run: exit 0, zero planned changes, porcelain empty + dir-snapshot unchanged | A2 + B2    |
| 3   | `hexagen sync` twice → second run byte-level idempotent                                                                  | B2         |
| 4   | Injected manifest error → `sync --dry-run` _and_ `arch validate` exit ≠0; tree untouched                                 | A1 + A2    |
| 5   | Forced failure under `--allow-dirty` with seeded untracked file → file survives                                          | B1         |

Row 2 is asserted **after** the first real sync — capstone injects the manifest after the bare scaffold, so the first sync legitimately has work; the zero-change contract holds from convergence onward (matching B2's fixtures). Plus the per-PR `node:test` + `node:assert/strict` contract suites (`tsx --test`) that spawn the **built `dist/cli.js`** — the dev-loop layer; capstone remains the published-shape layer (pack → install → bin shim → consumer-resolved deps).

**Self-regen vs external (recurring trap):** A3, B2 and C4 touch emitters used in both modes — re-run a self-sync on hexagen-monaco and diff before merging each.

**House-rule gates (every PR here):** tests are `node:test` + `node:assert/strict` via `tsx --test` — never vitest/jest/`expect()` (AGENTS.md mandate). Every new file (`journal.ts`, `commands/manifest/migrate.ts`, …) maps to a named element in `.architecture/manifest.yaml`, updated + `yarn lint:arch`-validated _before_ implementation. `turbo.json` / `.gitignore` are protected files — `--force-root` protocol with human confirmation (A1 needs this). The manifest marks `architectural-enforcement` and `code-generation` as `status: frozen` — check the touched context's status and clear the gate per-PR.

## Release sequencing

| Step | What                                                                                  | Gate                                          |
| ---- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | Wave A merges to main                                                                 | capstone + contract suites green              |
| 2    | Push `v0.7.0` tag → npm co-publish                                                    | **Martin's explicit go-ahead** (live publish) |
| 3    | Prod wizard deploy (LLM-overhaul wave or later)                                       | **must not precede step 2** (pin/npm lag)     |
| 4    | campaign-foundry: bump `^0.7.0`, wire `sync:dry` + `lint:arch` CI                     | after step 2                                  |
| 5    | Wave B merges → `v0.7.x` patch release                                                | go-ahead per tag, as always                   |
| 6    | campaign-foundry: switch CI to `sync --check` drift gate                              | after step 5                                  |
| 7    | Wave C as capacity allows (C1 before the next schema-evolving feature lands, ideally) | —                                             |

## Decision log (flagged for Martin; recommendations applied above)

- **D1 — Release vehicle:** fold P0 into the pending, unpublished **v0.7.0** (recommended) vs. cutting a `0.6.1` off the `v0.6.0` tag. Effectively **resolved by the version state** (main already bumped, tag unpushed) — reopens only if something forces a v0.7.0 publish before Wave A lands.
- **D2 — RCA #8:** option **(a)** — linter derives legality from `depends_on` (recommended; ADR) vs. (b) docs-honesty only.
- **D3 — `--check` shape:** `sync --check` implying dry-run (recommended) vs. a separate command.
- **D4 — Pin source npm-lag:** accept loud install failure + publish-before-deploy invariant (recommended) vs. querying the registry at scaffold time (rejected: network in the generation path).
- **D5 — Migration report default:** keep writing `SYNC-MIGRATION-REPORT.md` on real runs, stdout-only under dry-run (recommended) vs. opt-in `--report` everywhere.
- **D6 — Dead generators (`wiring.ts`, `test-generator.ts`, `migration-assistant.ts`):** delete in B2 (recommended — zero callers, recoverable from git, dead-normalizer precedent) vs. wire one live through the comparing writer (only if actually wanted; then it's its own PR with tests).

## Out of scope

- The sibling plan's remaining items (#2 / PR #267 tsconfig work, #7 wizard Applications-model redesign) — tracked there.
- campaign-foundry's own repairs — already done on its `fix/hexagen-tooling` branch; only the post-release bumps (Release sequencing 4/6) remain.
- Broader template-content overhauls beyond the specific dishonesty in RCA #9.
