# Sync Toolchain RCA & Remediation — Consumer Version Skew + CLI Safety

**Status:** Proposed. Not started.
**Date:** 2026-06-09
**Parent:** Sibling of [generator-scaffold-and-wizard-remediation.md](./generator-scaffold-and-wizard-remediation.md) — same source project (**campaign-foundry**), different layer. That plan fixes what the generator **emits** (templates, tsconfigs, CI files); this one fixes the **toolchain contract** between the wizard, the published CLIs (`@hexagen-monaco/sync`, `@hexagen-monaco/arch-linter`), and the consumer repo at runtime. Item #5 below supersedes/expands that plan's #8 ("sync rewrites ~50 unrelated files").

Locators are durable (file + symbol / search hint), not line numbers, per the planning house style. Every finding below was **empirically verified** in campaign-foundry on 2026-06-09 against the published npm artifacts (0.4.2 and 0.6.0), not inferred from source; the evidence appendix records the method.

## Incident

campaign-foundry was scaffolded by the wizard (~Jun 6–7) and shipped through several PRs with green CI — while **every hexagen command in it was broken from day one**:

```
$ yarn sync:dry
[sync] Sync failed: Failed to parse manifest: [
  { "code": "unrecognized_keys", "keys": ["workspaceTemplate"], ... }]
$ echo $?
0
```

`sync`, `sync:dry`, `arch validate`, `validate-templates`, and `hexagen-lint` all failed identically (they all load the manifest first) — and **all exited 0**, so nothing could have gated on it. The consumer was repaired on its branch `fix/hexagen-tooling` (pin bump to `^0.6.0` + `.architecture/` reconciliation + first successful sync, byte-level idempotent, all gates green). This plan ports the underlying fixes upstream so the next generated project never needs that repair.

## Timeline

| When (2026) | Event                                                                                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jun 1–2     | `@hexagen-monaco/sync` 0.4.0–0.4.2 published                                                                                                                                                                                                              |
| Jun 2–3     | 0.5.0–0.5.2 published                                                                                                                                                                                                                                     |
| Jun 6       | `77f6885a` (#241, "invariant honesty") adds `workspaceTemplate: z.string().optional()` to the manifest schema (`packages/project-configuration` · `ManifestSchema`) — the wizard records the chosen workspace template into `.architecture/manifest.yaml` |
| ~Jun 6–7    | campaign-foundry scaffolded by the wizard running 0.6.x-era main: manifest contains `workspaceTemplate`; scaffolded `package.json` pins `^0.4.0`                                                                                                          |
| Jun 9 02:53 | 0.6.0 published — the **first artifact whose schema accepts the key**                                                                                                                                                                                     |
| Jun 9       | Incident diagnosed in campaign-foundry; consumer fixed on `fix/hexagen-tooling`                                                                                                                                                                           |

## Root cause

**The scaffold's CLI pins are decoupled from the schema the wizard writes.** `BUILTIN_PACKAGE_JSON` scaffolding (`packages/sync/src/generators/root-file-templates.ts` · the hard-coded `"@hexagen-monaco/sync": "^0.4.0"` / `"@hexagen-monaco/arch-linter": "^0.4.0"` devDependencies) ships a fixed version range, while the wizard emits a manifest conforming to whatever schema **main** has at scaffold time. Caret on a 0.x version never crosses the minor (`^0.4.0` ⇒ 0.4.x only), so the gap is permanent, not self-healing: the consumer resolved 0.4.2, whose strict zod parse (`unrecognized_keys`) rejects the 0.6.x manifest.

Condensed five-whys:

1. Every hexagen command in the consumer failed → installed 0.4.2 rejects `workspaceTemplate` in `manifest.yaml`.
2. Why is the key there → the wizard (0.6.x-era code) wrote it, by design (#241).
3. Why is the consumer's CLI older → the scaffold hard-pins `^0.4.0`, and 0.x caret semantics freeze the minor.
4. Why didn't anything catch it → there is no contract test that _the manifest the wizard just wrote parses under the pins the scaffold just emitted_ (the generate→clone→build loop in the sibling plan does not yet run the hexagen CLIs inside the generated project).
5. Why didn't the consumer's own CI catch it → it couldn't have: **every failure mode exits 0** (item #2). Defect #2 masks defect #1 — even a `yarn sync:dry` CI step wired from day one would have stayed green. This double-masking is the durable lesson of the RCA.

## Summary

| Phase  | Item                                                                          | Severity         | Source (file · symbol)                                                                                                    | Blast radius                                            |
| ------ | ----------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **P0** | #1 Scaffold pins decoupled from wizard schema                                 | **Critical**     | `sync/src/generators/root-file-templates.ts` · scaffold devDependencies                                                   | every newly generated project                           |
| **P0** | #2 Failure exit codes are 0 across the CLIs                                   | **Critical**     | `sync/src/sync-engine.ts` · `run()` catch; `sync/src/cli.ts` · `program.parse` tail; `sync/src/commands/arch/validate.ts` | all consumer CI gating; masks every other defect        |
| **P0** | #3 `--dry-run` writes and deletes in the consumer tree                        | High             | `sync/src/generators/barrels/recursive.ts` · empty-content unlink branch; `sync/src/migration-report.ts` · report flush   | "preview" mutates the repo; user trust                  |
| **P1** | #4 Failure rollback is `git reset --hard && git clean -fd`                    | High (data loss) | `sync/src/sync-engine.ts` · `run()` catch rollback                                                                        | consumer's uncommitted **and untracked** work           |
| **P1** | #5 No-op rewrites reported as create/update — drift undetectable              | Medium (DX)      | write paths across `sync/src/generators/*`; `barrels/recursive.ts` pushes unlinks into `result.created`                   | `sync:dry` unusable as a drift gate; expands sibling #8 |
| **P2** | #6 No manifest `schemaVersion` / migration path                               | Medium           | `project-configuration` · `ManifestSchema`; `sync/src/commands/manifest/*`                                                | cross-version failures surface as raw zod output        |
| **P2** | #7 Root-resolution error omits the install-location footgun                   | Low              | `sync/src/sync-engine-init.ts` · workspace-root walk-up throw                                                             | npx/global users get "No package.json with workspaces"  |
| **P2** | #8 Linter ignores manifest `depends_on`; invariants files are the only source | Medium (design)  | `arch-linter` · invariants/linter-config loading                                                                          | spec vs enforcement split confuses consumers            |
| **P2** | #9 Scaffold writes aspirational/inconsistent governance content               | Low–Med          | `root-file-templates.ts` / template-engine (AGENTS.md, `.gitignore.hexagen`, `generator.config.yaml`)                     | consumer docs + compliance bots mislead                 |

---

## #1 — Scaffold pins decoupled from the wizard's schema · P0 (Critical)

**Root cause.** See above. The literal `^0.4.0` strings live in `root-file-templates.ts` and are not derived from anything.

**Fix.** Derive the scaffolded pins from the running engine's own version at generation time (read the sync package.json version, emit `^<currentVersion>` or an exact pin). The wizard and the scaffolded CLI are then the same code generation by construction.

**Acceptance.** Golden test: run the wizard/scaffold end-to-end, `yarn install` **with the scaffolded pins**, then run `hexagen sync --dry-run` and `hexagen arch validate` inside the generated project; both must load the manifest. This belongs inside the sibling plan's generate→clone→build CI loop (extend it; don't build a second harness).

## #2 — Failure exit codes are 0 across the CLIs · P0 (Critical)

**Observed (published 0.4.2 and 0.6.0, consumer repo):** manifest parse failure under `sync --dry-run` → exit 0; manifest failure under `arch validate` → exit 0; _real boundary violations_ under `arch validate` → exit 0. The only confirmed nonzero path is a preflight throw (e.g. dirty tree) reaching the CLI catch.

**Root cause(s).**

- `sync-engine.ts` · `run()` catch: logs `Sync failed: …`, then exits **only inside `if (!dryRun)`** — dry-run failures are swallowed and `run()` returns normally.
- `commands/arch/validate.ts` _does_ contain `process.exit(1)` on both failure paths (present at tag v0.6.0), yet the published binaries exit 0. The swallow point is not yet pinned — candidates: the async action behind a **sync** `program.parse(process.argv)` (`cli.ts` · `buildProgram` tail; async action rejections never reach the surrounding try/catch), or publish-time bundle divergence from the tag. Pinning it is part of the fix.
- Same audit applies to `arch-linter`'s `hexagen-lint` bin.

**Fix.** (a) Switch to `await program.parseAsync()` with a top-level rejection handler that sets `process.exitCode = 1`. (b) In `run()`, rethrow (or set exitCode) on dry-run failure instead of swallowing. (c) Audit every subcommand for the same pattern.

**Acceptance.** Exit-code contract tests that run the **built `dist/cli.js`** (not the TS source) against fixture projects: success → 0; broken manifest → ≠0 (both `sync --dry-run` and `arch validate`); violations → ≠0. Testing the built artifact is the point — it catches the swallow wherever it lives, including bundling regressions.

## #3 — `--dry-run` writes and deletes in the consumer tree · P0 (High)

**Observed.** Every `sync --dry-run` in the (pre-convergence) consumer deleted `packages/shared/src/domain/value-objects/index.ts` and `packages/shared/src/infrastructure/adapters/index.ts` (legacy empty `export {}` barrels) and wrote `SYNC-MIGRATION-REPORT.md` — repeatable on each run until a real sync converged the tree.

**Root cause.** `generators/barrels/recursive.ts` · the empty-content branch of the pending-write loop calls `fs.unlink(pending.filePath)` unconditionally — the dry-run flag gates the _writes_ around it but not this delete (and the unlink is pushed into `result.created`, which is also item #5). `migration-report.ts` · the report flush opens a write stream unconditionally.

**Fix.** Thread the dry-run flag through every filesystem mutation: deletes become "would delete" plan entries; the migration report goes to stdout (or a `--report <path>` opt-in) under dry-run. Audit all `unlink`/`rm`/`createWriteStream` sites in `sync/src/generators/*` and `migration-report.ts`.

**Acceptance.** Contract test: run `sync --dry-run` on a fixture repo with legacy/empty barrels; `git status --porcelain` must be empty afterwards.

## #4 — Failure rollback is `git reset --hard HEAD && git clean -fd` · P1 (High, data loss)

**Root cause.** `sync-engine.ts` · `run()` catch: on non-dry-run failure it hard-resets and force-cleans the **consumer's** working tree. The default clean-tree preflight mitigates the common case, but: (a) `--allow-dirty` + a failure destroys the user's uncommitted work; (b) `git clean -fd` removes untracked files sync never touched (editor scratch files, local notes, new files not yet added).

**Fix.** Replace with a scoped rollback: snapshot exactly the paths sync plans to touch (or `git stash create` before mutating) and restore only those. Never run any rollback when `--allow-dirty` was passed — fail loudly and leave the tree for the user. Print precisely what was rolled back.

**Acceptance.** Test: seed a fixture with an untracked file + a dirty tracked file, force a mid-sync failure under `--allow-dirty`; both files must survive.

## #5 — No-op rewrites reported as create/update; drift undetectable · P1 (Medium, DX)

**Observed.** On a **fully converged** tree (a second real sync changes zero bytes — verified via `git status` after back-to-back runs), `sync --dry-run` still prints ~43 "would create/update" lines and the real-run summary still reports "67–70 created, 18–21 updated". Generators write unconditionally and count the write, not the change; deletions are even counted as `created` (see #3).

**Root cause / Fix.** Content-compare before write across the generator write paths; report and count only real differences; give deletions their own counter. Then `sync --dry-run` doubles as a true drift detector (exit ≠0 with `--check`-style semantics, or a dedicated `--check` flag), which is what consumer CI actually wants to run. This supersedes sibling plan #8: the "~50 unrelated rewrites" were same-content writes — fixing the comparison fixes both the noise and the false summary.

**Acceptance.** On a converged fixture: dry-run prints zero planned changes and exits 0; after deleting one generated barrel, it prints exactly one planned change and (with `--check`) exits ≠0.

## #6 — No manifest `schemaVersion` / migration path · P2

**Root cause.** The manifest carries no schema version, so an older CLI meeting a newer manifest fails with raw zod `unrecognized_keys` output — accurate but useless to a consumer.

**Fix.** Add `schemaVersion` to `ManifestSchema` (written by the wizard, defaulted for legacy manifests); on mismatch, fail with "this manifest requires @hexagen-monaco/sync ≥ X — run `hexagen manifest migrate`". Add `hexagen manifest migrate` alongside the existing `manifest split`. With #1 fixed this is belt-and-braces, but it is what turns the next inevitable skew (consumers upgrade one side eventually) from a cryptic failure into a guided one.

## #7 — Root-resolution error omits the install-location footgun · P2 (Low)

**Observed.** Running the published CLI via the npx cache fails with `Could not locate monorepo root. No package.json with "workspaces" field found` — because root resolution walks up from the **engine's install location** (the documented footgun, README issue #179), and the npx cache has no workspace above it. The message gives no hint.

**Fix.** Extend the throw in `sync-engine-init.ts`: state where the walk started, and add "if you ran this via npx or a global install, install @hexagen-monaco/sync as a devDependency of your project instead." Optionally prefer `process.cwd()` resolution in the published-CLI (`external`) mode.

## #8 — Linter ignores manifest `depends_on`; invariants files are the only source · P2 (Medium, design)

**Observed (consumer).** Adding `CampaignOrchestration` to three contexts' `depends_on` in `manifest.yaml` changed nothing in `arch validate` output; the operative config was `.architecture/invariants/linter-config.yaml` · `global_whitelist`. The manifest says `arch validate` checks "against manifest.yaml" (and its success message claims compliance _with manifest.yaml_), but cross-package import legality is in practice decided by the invariants files alone.

**Fix (pick one, document either way).** Either (a) the linter derives allowed cross-context imports from manifest `depends_on` (per-context precision, manifest as single source of truth) with invariants as additional constraints, or (b) the docs/messages stop claiming the manifest governs imports and the wizard generates the invariants whitelist _from_ `depends_on` at scaffold time. (a) is architecturally cleaner; (b) is cheaper.

## #9 — Scaffold writes aspirational/inconsistent governance content · P2 (Low–Med)

**Observed in the consumer.**

- Scaffolded `AGENTS.md` mandates a structured logger at `src/infrastructure/logging/logger.ts` ("from the observability template") and `eslint-no-console` enforcement — neither exists in the generated project (no logger module, no lint rule, and the monorepo has no root `src/`). A compliance review bot (qodo rule 960794) ingested that text and flagged every PR that logs, demanding a fix pointing at a nonexistent file.
- `.gitignore.hexagen` says "`hexagen validate-templates` expects every template output to stay present", while `validate-templates` reports "No templates installed in this project."
- `generator.config.yaml` · `ownership-registry.ports` maps the `ExternalServiceClient` key **twice** (CreativeGeneration and Distribution) — duplicate YAML keys, the first silently dropped, contradicting its own `port-single-ownership` invariant. The same concept is also spelled `workspaceTemplate` (manifest) and `workspace_template` (generator config).

**Fix.** Scaffolded governance docs must only describe what the scaffold actually installs (template-conditional sections); fix the duplicate-key emission and unify the template-id field spelling. These are template-content fixes in the same files the sibling plan already touches — coordinate there.

---

## Cross-cutting acceptance gate

Extend the sibling plan's generate→clone→build CI loop into a full **toolchain contract** run, executed against the _built/published-shape_ artifacts:

1. Scaffold a project with the wizard (or golden fixture manifest) → `yarn install` with the **scaffolded** pins (#1).
2. `hexagen sync --dry-run`: exit 0, **zero** planned changes on the fresh scaffold (#5), `git status --porcelain` empty (#3).
3. `hexagen sync` twice: second run byte-level idempotent.
4. Inject a manifest error: `sync --dry-run` and `arch validate` exit ≠0 (#2); tree untouched (#3).
5. Failure under `--allow-dirty` with a seeded untracked file: file survives (#4).

## Release & consumer follow-up

- Ship P0 (#1–#3) as **0.6.1**; P1 in 0.6.2 or alongside.
- campaign-foundry (already on `^0.6.0`, branch `fix/hexagen-tooling`): after 0.6.1, bump and wire `yarn sync:dry --check` + `yarn lint:arch` into CI — deliberately left unwired today because exit codes are dishonest (its `.agents/session-log.md`, 2026-06-09 entry, records this).

## Evidence appendix (how each claim was verified, 2026-06-09)

- **A/B schema test:** sandbox dirs with the real consumer `.architecture/` + minimal workspaces `package.json`, `npm i @hexagen-monaco/sync@0.4.2` vs `@0.6.0`: 0.4.2 → `unrecognized_keys: workspaceTemplate`; 0.6.0 → `Loaded manifest …`. Published tarballs also diff materially (sync dist 387→415 KB; `generators/cross-context` only in 0.6.0), refuting "grouped bump, no code change".
- **Schema provenance:** `git log -S 'workspaceTemplate: z.string().optional()'` → `77f6885a` (Jun 6); ancestor of v0.6.0, not of ≤v0.5.2; npm publish times bracket it.
- **Dry-run mutation:** clean consumer tree → `yarn sync:dry` → `git status` shows two deletions + untracked report; repeatable until convergence.
- **Idempotency & gates:** throwaway clone of the consumer branch: real sync applied, second sync → empty `git status`; build/typecheck/lint/test:cov (287 tests, 100%-coverage thresholds) green on the synced tree.
- **Exit codes:** broken-manifest and violation fixtures, `echo $?` after each command on the installed published CLIs → 0 in all three failure modes.
- **Pin origin:** `grep -rn '\^0\.4\.0' packages/sync/src/generators` → `root-file-templates.ts` devDependencies block; unchanged since v0.6.0 (`git log v0.6.0..HEAD` on the file is empty).
